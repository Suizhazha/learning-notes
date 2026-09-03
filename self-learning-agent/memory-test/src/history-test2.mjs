// =============================================================================
// src/history-test2.mjs
// -----------------------------------------------------------------------------
// 学习目标：LangChain 持久化版 ChatMessageHistory —— FileSystemChatMessageHistory
//
// 与 history-test.mjs 的差异（仅一条 import + 一条 new 语句替换，其余完全一致）：
//   - 内存版：new InMemoryChatMessageHistory()                 → 进程退出即丢
//   - 文件版：new FileSystemChatMessageHistory({ filePath, sessionId })
//                                                                 → 写入本地 JSON，重启仍存活
//
// 本脚本核心思想："会话"=1 个 sessionId；history 实例 = 1 个会话的入口；
// FileSystemChatMessageHistory 把所有属于该 sessionId 的消息序列化到 JSON 文件里。
//
// 设计模式：手动管理（5 步法）+ 持久化扩展步骤（resolve_filepath / bind_session / print_persist_notice）
//
// -----------------------------------------------------------------------------
// 行号对照表（与 src/history-test.mjs 横向对比）
// -----------------------------------------------------------------------------
//  | 本脚本     | history-test.mjs | 差异                                  |
//  |-----------|------------------|---------------------------------------|
//  | 21        | 8                | 相同：dotenv/config                   |
//  | 25        | 3                | 相同：ChatOpenAI                      |
//  | 30        | 5                | ★ 不同：FileSystemChatMessageHistory |
//  | 35        | 4                | 相同：HumanMessage/SystemMessage     |
//  | 41        | -                | ★ 新增：path（持久化要写文件）       |
//  | 48-59     | 6-13             | 相同：ChatOpenAI 初始化              |
//  | 71        | -                | ★ 新增：解析文件路径                 |
//  | 83        | -                | ★ 新增：绑定 sessionId               |
//  | 88-90     | 18-20            | 相同：构造 SystemMessage             |
//  | 102-105   | 16               | ★ 不同：new 时传 { filePath, sessionId } |
//  | 109-113   | 24-25            | 相同：构造 HumanMessage + addMessage |
//  | 120       | 27               | 相同：拼 messages（getMessages 多一层 await）|
//  | 124       | 28               | 相同：model.invoke                   |
//  | 129       | 29               | 相同：addMessage(AIMessage)          |
//  | 133-134   | 31-32            | 相同：打印本轮对话                   |
//  | 140       | -                | ★ 新增：持久化提示                   |
//  | 151-168   | 34-44            | 相同：第二轮 5 步法                  |
//  | 186       | 58               | 相同：.catch(console.error)          |
//
// 结论：除 ★ 标记的 5 处持久化扩展外，两脚本其余结构 1:1 对应——
//       这种"接口不变、只换实现类"的写法正是 BaseChatMessageHistory 抽象的价值。
// =============================================================================


// =============================================================================
// 0. 依赖导入
// =============================================================================
import 'dotenv/config';
// dotenv/config 是 .env 文件自动加载入口；放在所有 import 的最前面，
// 确保后续 process.env.* 能立即读到 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME。

import { ChatOpenAI } from '@langchain/openai';
// 与 history-test.mjs 一样，使用 OpenAI 兼容协议的 Chat 客户端。
// 即使底层是阿里 DashScope / 小米 mimo / OpenAI，接口形态都是一致的。

// ★ 本脚本的核心 import：持久化版 history
import { FileSystemChatMessageHistory } from "@langchain/community/stores/message/file_system";
// FileSystemChatMessageHistory 继承自 BaseChatMessageHistory 接口（addMessage / getMessages / clear 三件套）。
// 内部把消息以 JSON 形式追加到一个共享文件中，按 sessionId 分区。
// 路径：@langchain/community/stores/message/file_system（属于社区包，需要安装 @langchain/community）。

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
// HumanMessage = 用户输入（type='human'）
// SystemMessage = 角色设定（type='system'），不会被写入 history，每轮临时拼到 messages 头部
// 注意：本脚本没用 AIMessage，因为 AIMessage 是 model.invoke() 的返回值，无需手动 import。

// 解析磁盘文件路径需要 Node 内置 path 模块
import path from "node:path";
// node: 前缀是 Node 官方推荐的写法，明确是内置模块，避免与第三方包冲突。


// =============================================================================
// 1. 初始化模型（与 history-test.mjs 完全一致）
// =============================================================================
const model = new ChatOpenAI({
  // 模型名从 .env 读，本项目 = qwen3.7-max-2026-06-08（阿里 DashScope 兼容端点下的模型）
  modelName: process.env.MODEL_NAME,
  // API Key 从 .env 读；本项目用的是兼容 Key，由 baseURL 决定走哪家
  apiKey: process.env.OPENAI_API_KEY,
  // 温度 0 = 确定性输出；做"是否记住上下文"的对照测试时尤其重要——相同输入应得到相同回复
  temperature: 0,
  configuration: {
    // 兼容端点的 baseURL；本项目 = https://dashscope.aliyuncs.com/compatible-mode/v1
    baseURL: process.env.OPENAI_BASE_URL,
  },
});


// =============================================================================
// 2. 主流程：演示 FileSystemChatMessageHistory 的两轮多轮对话
// =============================================================================
async function fileHistoryDemo() {
  // ---------- 持久化扩展步骤 1：解析文件路径 (step.resolve_filepath) ----------
  // 用 path.join(process.cwd(), 'chat_history.json') 拼出"绝对路径"。
  // 这里为什么不用 __dirname？因为本项目是 ESM（package.json 里 "type": "module"），
  // ESM 下 __dirname 不可用；process.cwd() 是等价的兜底写法。
  // 路径 = <运行 node 命令时所在目录>/chat_history.json
  const filePath = path.join(process.cwd(), "chat_history.json");
  // @graph: step.resolve_filepath

  // ---------- 持久化扩展步骤 2：绑定 sessionId (step.bind_session) ----------
  // sessionId = 会话的唯一标识，是持久化 history 的"分区键"。
  // 同一个 sessionId 多次 new FileSystemChatMessageHistory(...) 实例时，
  // 它们共享磁盘文件中的同一段消息数组——这是"多轮对话真的连续"的物理保证。
  //
  // 演示场景硬编码为 'user_session_001'；生产环境应替换为：
  //   - 用户登录后的 userId
  //   - req.session.id（Express Session）
  //   - JWT 中的 sub 字段
  //   - WebSocket 连接 ID
  const sessionId = "user_session_001";
  // @graph: step.bind_session

  // ---------- 与 history-test.mjs 一致：构造 SystemMessage ----------
  // SystemMessage 不写入 history，每轮 invoke 时临时拼到 messages 数组最前面。
  // 这样"角色设定"既每轮都被模型看到，又不会被算入历史 token。
  const systemMessage = new SystemMessage(
    "你是一个友好的做菜助手，喜欢分享美食和烹饪技巧。"
  );


  // ============== 第一轮对话：持久化版的 5 步法 + 持久化扩展 ==============
  console.log("[第一轮对话]");

  // ---------- 持久化扩展步骤 3：创建持久化 history 实例 (step.open_history_persistent) ----------
  // 与 InMemoryChatMessageHistory 的关键区别：
  //   - InMemory 版：构造完得到一个空数组。
  //   - FileSystem 版：构造时立即读磁盘文件 chat_history.json，解析出属于 sessionId='user_session_001' 的消息数组；
  //     如果文件不存在或没有该 sessionId，则得到空数组。
  //   也就是说：第一次运行时是空数组，第二次运行同一脚本会自动加载第一轮留下的消息！
  //
  // -----------------------------------------------------------------------------
  // 【构造时内部行为】new FileSystemChatMessageHistory({ filePath, sessionId })
  // -----------------------------------------------------------------------------
  //  按发生顺序大致做了 6 件事（阅读源码 https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-community/src/stores/message/file_system.ts 验证）：
  //    1. 校验两个必填字段 filePath / sessionId，缺一即抛 TypeError；
  //    2. 调用内部 readAll(path)：fs.readFileSync → JSON.parse → 得到 Record<sessionId, Message[]>;
  //       若文件不存在则捕获 ENOENT，初始化为 {}；
  //    3. 从 Record 里取出 this.sessionId 对应的那段 Message[]（缺则返回 []）；
  //    4. 把这段数组用 .map(deserializeStoredMessage) 反序列化为 HumanMessage/AIMessage/... 实例；
  //    5. 暂存到 this.messages（一个 Map<sessionId, BaseMessage[]>，多个会话共享一个实例时用）；
  //    6. 返回 this，此后 addMessage/getMessages 都在内存 Map 上做，最后异步写盘。
  //  性能提示：每次 addMessage 都会全量写整个 JSON 文件，所以"长会话 + 高频追加"场景
  //  不适合用 FileSystem——这种时候应该换成 RedisChatMessageHistory / SQLiteChatMessageHistory。
  //  线程安全：内部用 fs.promises.writeFile 但无文件锁，多进程并发写同一文件可能丢数据；
  //  生产上要么换 Redis、要么外加锁。
  const history = new FileSystemChatMessageHistory({
    filePath: filePath,  // 必填：JSON 文件的存储路径
    sessionId: sessionId, // 必填：会话标识，作为"分区键"
  });
  // @graph: step.open_history_persistent

  // ---------- 5 步法 第 1 步：构造并 addMessage HumanMessage ----------
  // 用户的输入："红烧肉怎么做"
  const userMessage1 = new HumanMessage(
    "红烧肉怎么做"
  );
  // addMessage 是 BaseChatMessageHistory 的标准方法；FileSystem 版内部会 JSON 序列化后追加到磁盘文件。
  await history.addMessage(userMessage1);


  // ---------- 5 步法 第 2 步：拼装 messages 数组 ----------
  // 这是"上下文传递机制"的具体动作：[systemMessage, ...history.getMessages()]
  // - systemMessage 放最前面，让模型每轮都看到角色设定
  // - history.getMessages() 返回当前 session 累积的全部消息（注意是 await，因为它要异步读磁盘）
  const messages1 = [systemMessage, ...(await history.getMessages())];

  // ---------- 5 步法 第 3 步：调用模型 ----------
  // 把 messages 数组丢给模型，返回一个 AIMessage 实例。
  const response1 = await model.invoke(messages1);

  // ---------- 5 步法 第 4 步：把模型回复写入 history ----------
  // 这是"记忆"最关键的一步：少了它，下一轮模型就不知道前面说过什么。
  // FileSystem 版内部会立即把这条 AIMessage 持久化到 chat_history.json。
  await history.addMessage(response1);


  // ---------- 打印本轮对话 ----------
  console.log(`用户: ${userMessage1.content}`);
  console.log(`助手: ${response1.content}`);

  // ---------- 持久化扩展步骤 4：打印持久化提示 (step.print_persist_notice) ----------
  // 这是"持久化生效"的可视化验证。
  // 与 history-test.mjs 不同：内存版没有可观察的外部副作用；FileSystem 版每轮都能打印路径，
  // 让用户知道消息已经落到磁盘。
  console.log(`✓ 对话已保存到文件: ${filePath}\n`);


  // ============== 第二轮对话：注意 history 已经被持久化扩展步骤"装载"了第一轮消息 ==============
  console.log("[第二轮对话]");

  // 注意：这里没有再 new 一个 history 实例，而是复用上面那个。
  // 但即便是 new 一个新的实例，只要 filePath + sessionId 相同，
  // 构造时也会从磁盘读到上一轮的 2 条消息（HumanMessage + AIMessage）。
  // 这是 FileSystem 版最大的优势：跨 new 实例、跨进程都能保留历史。

  const userMessage2 = new HumanMessage(
    "好吃吗？"
  );
  await history.addMessage(userMessage2);

  // 拼装 messages 时，history.getMessages() 现在已经包含第一轮的 2 条 + 第二轮的 1 条 = 3 条历史消息
  // 所以 messages2 = [system, human1, ai1, human2] 共 4 条
  const messages2 = [systemMessage, ...(await history.getMessages())];

  const response2 = await model.invoke(messages2);
  // 关键：因为 messages2 里有"红烧肉怎么做"和模型对红烧肉的回复，
  // 回答"好吃吗？"时模型能基于前文回答，而不是答非所问。

  await history.addMessage(response2);

  console.log(`用户: ${userMessage2.content}`);
  console.log(`助手: ${response2.content}`);
  console.log(`✓ 对话已更新到文件\n`);

  // 跑完后，运行 `cat chat_history.json` 可以看到完整的 JSON 结构，类似：
  // {
  //   "user_session_001": [
  //     { "type": "human", "data": { "content": "红烧肉怎么做", ... } },
  //     { "type": "ai", "data": { "content": "...", ... } },
  //     { "type": "human", "data": { "content": "好吃吗？", ... } },
  //     { "type": "ai", "data": { "content": "...", ... } }
  //   ]
  // }
  // 下次再运行同一个脚本时，第一轮的"红烧肉"对话会自动恢复（除非换 sessionId）。
  //
  // -----------------------------------------------------------------------------
  // 【chat_history.json 完整结构解读】
  // -----------------------------------------------------------------------------
  // 顶层：Record<sessionId, StoredMessage[]>，所有会话共用一个文件
  // 第二层：每个 sessionId 映射一个按时间顺序追加的消息数组
  // StoredMessage 结构（来自 @langchain/core 的 serializeStoredMessage 协议）：
  //   {
  //     "type": "human" | "ai" | "system" | "tool" | "function",
  //     "data": {
  //       "content":  string | MessageContentComplex[]   // 文本或多模态
  //       "name"?:    string                            // tool/function 消息的函数名
  //       "tool_call_id"?: string                       // tool 消息的调用 ID
  //       "additional_kwargs": { ... }                   // 模型返回值里的 tool_calls 等扩展信息
  //       "response_metadata": { ... }                  // 模型返回的 token usage、finish_reason 等
  //     }
  //   }
  // 多会话示例（同文件里同时有 2 个用户）：
  // {
  //   "user_session_001": [ {type:"human", ...}, {type:"ai", ...} ],
  //   "user_session_002": [ {type:"human", ...}, {type:"ai", ...}, {type:"human", ...} ]
  // }
  //
  // -----------------------------------------------------------------------------
  // 【多会话工厂示例】把硬编码 sessionId 换成工厂函数
  // -----------------------------------------------------------------------------
  // 生产场景（Express + RunnableWithMessageHistory）：
  //   import { RunnableWithMessageHistory } from "@langchain/core/runnables";
  //
  //   const chatWithHistory = new RunnableWithMessageHistory({
  //     runnable: model,
  //     getMessageHistory: (sessionId) => new FileSystemChatMessageHistory({
  //       filePath: path.join(process.cwd(), "chat_history.json"),
  //       sessionId,
  //     }),
  //     inputMessagesKey: "input",
  //     historyMessagesKey: "history",
  //   });
  //
  //   // 路由层：
  //   app.post("/chat", (req, res) => {
  //     const sessionId = req.user.id;        // ← 关键：从登录态/cookie 取
  //     return chatWithHistory.stream(
  //       { input: req.body.message },
  //       { configurable: { sessionId } }      // ← 这里传入，框架自动路由到正确的 history
  //     );
  //   });
  //
  // 这样就实现了"一份 JSON 文件，按 sessionId 隔离，多用户并发"的完整方案。
}


// =============================================================================
// 3. 启动入口
// =============================================================================
fileHistoryDemo().catch(console.error);
// .catch(console.error) 把异常打到 stderr；任何一步失败（比如 API Key 错、磁盘无写权限）
// 都会立刻冒出来，不会被静默吞掉。
//
// -----------------------------------------------------------------------------
// 【典型异常分类】—— 调试时可按这里对照错误堆栈
// -----------------------------------------------------------------------------
// 1. 模型调用层
//    - 401 / AuthenticationError：.env 里的 OPENAI_API_KEY 错或 baseURL 不匹配
//    - 404 / NotFoundError：MODEL_NAME 写错，或兼容端点没这个模型
//    - 429 / RateLimitError：并发超限；稍候重试或换 RPM 更高的套餐
//    - NetworkError：代理/防火墙拦截（开发机常踩）
//
// 2. 持久化层（持久化版才会遇到的错）
//    - EACCES / EPERM：chat_history.json 所在目录无写权限（常见于 docker 里挂只读卷）
//    - ENOENT：filePath 的父目录不存在；要么 mkdir -p，要么把文件放在 cwd 下
//    - SyntaxError（JSON.parse）：上次进程崩溃导致文件被截断；解决：删文件重来 + 加原子写
//    - EBUSY / EAGAIN：另一进程独占占用文件（Windows 常见）；解决：用 SQLite/Redis 替换
//    - EISDIR：传错路径，把目录当成文件了
//
// 3. 业务逻辑层
//    - TypeError: filePath is required：构造 FileSystemChatMessageHistory 时漏传
//    - TypeError: sessionId is required：同上
//    - context_passing 漏 await getMessages()：messages 永远是空数组，模型"失忆"
//
// -----------------------------------------------------------------------------
// 【生产级建议】写盘失败时的兜底
// -----------------------------------------------------------------------------
// fileHistoryDemo().catch(async (err) => {
//   console.error("[ERROR]", err);
//   // 可选：写一份告警日志、发送钉钉/Slack、回滚本次会话
//   // process.exit(1);   // 非交互式脚本建议明确退出码
// });