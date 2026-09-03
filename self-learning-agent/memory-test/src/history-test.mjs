// =============================================================================
// history-test.mjs — LangChain InMemoryChatMessageHistory 多轮对话示例
// =============================================================================
//
// 【学习目标】
//   1. 理解 LangChain 中“对话记忆”（ChatMessageHistory）的抽象与作用
//   2. 掌握 InMemoryChatMessageHistory 的初始化、addMessage、getMessages 用法
//   3. 理解 SystemMessage / HumanMessage / AIMessage 三类核心消息的含义
//   4. 掌握“手动管理”模式下的五步法（构造→追加→拼装→调用→追加）
//   5. 理解上下文传递机制：把累积的历史拼进 messages 让 LLM “记住”前面说过的话
//   6. 观察 token 随轮次线性增长的现象，铺垫后续窗口截断 / 摘要压缩的学习
//
// 【运行环境】
//   - 依赖：@langchain/openai、@langchain/core、dotenv
//   - 环境变量：MODEL_NAME / OPENAI_API_KEY / OPENAI_BASE_URL（参见 .env）
//   - 运行：node src/history-test.mjs
//
// =============================================================================

// -----------------------------------------------------------------------------
// 1. 依赖加载
// -----------------------------------------------------------------------------
// dotenv/config：把 .env 中的环境变量载入到 process.env
// 这样下面的 process.env.MODEL_NAME 等就能拿到真实值
import "dotenv/config";

// ChatOpenAI：LangChain 对 OpenAI 兼容协议的封装。
//             通过 baseURL 可指向任何 OpenAI 兼容端点（阿里 DashScope / 小米 mimo / OneAPI 等）
import { ChatOpenAI } from "@langchain/openai";

// InMemoryChatMessageHistory：LangChain 提供的“进程内存版”对话历史实现。
//                            历史只存在内存数组里，进程退出即丢失。
//                            适合单进程 demo / 单元测试 / 学习用途。
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

// HumanMessage / SystemMessage：LangChain 中的两类核心消息类型。
//   HumanMessage —— 代表“用户”发出的消息（type='human'）
//   SystemMessage —— 代表“系统级角色设定”（type='system'），一般每轮临时拼在 messages 最前面
// 模型的回复是 AIMessage（type='ai'），由 model.invoke() 直接返回，无需单独导入类
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// -----------------------------------------------------------------------------
// 2. 初始化 LLM 客户端
// -----------------------------------------------------------------------------
// ChatOpenAI 的 4 项关键配置：
//   - modelName    ：模型标识（qwen3.7-max-2026-06-08 / mimo-v2.5-pro 等）
//   - apiKey       ：对应端点的 API Key（从 .env 读，避免硬编码）
//   - temperature  ：采样温度；本项目设为 0 让输出尽量确定，方便对照测试
//   - configuration.baseURL：OpenAI 兼容端点的 baseURL
//                            这里指向阿里 DashScope 的兼容模式入口
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// -----------------------------------------------------------------------------
// 3. InMemoryChatMessageHistory 多轮对话演示（手动管理 5 步法）
// -----------------------------------------------------------------------------
// 本函数演示“手动管理”模式：业务代码显式地维护 history，
// 每轮对话严格遵循以下 5 步：
//
//   (1) construct —— 构造 HumanMessage（用户输入）
//   (2) addMessage —— 把 HumanMessage 写入 history
//   (3) compose    —— 拼装 messages = [systemMessage, ...history.getMessages()]
//   (4) invoke     —— model.invoke(messages) → AIMessage（模型回复）
//   (5) addMessage —— 把 AIMessage 写回 history（关键的“记忆”动作）
//
// 关键观察点：
//   - 每轮结束后 history 的长度都比上一轮多 2 条（+1 HumanMessage、+1 AIMessage）
//   - SystemMessage 不进 history，但每轮都会被拼到 messages 头部
//   - 第二轮的问题“你今天吃的什么？”实际上没有再出现，但模型能基于第一轮的回复作答
//     ——这正是“上下文传递”带来的效果
async function inMemoryDemo() {
  // 第 0 步：创建 history 实例（进程内存）
  // 这一步相当于在内存里开一个空数组，后续所有 addMessage 都会追加到这里
  const history = new InMemoryChatMessageHistory();

  // 第 0 步：构造系统级角色设定（SystemMessage）
  // SystemMessage 不写入 history，而是每轮临时拼在 messages 数组最前面
  // 这样既保证角色设定稳定生效，又不会污染历史（避免 system 文本被算入历史 token 消耗）
  const systemMessage = new SystemMessage(
    "你是一个友好、幽默的做菜助手，喜欢分享美食和烹饪技巧。",
  );

  // ===========================================================================
  // 第一轮对话：用户问“你今天吃的什么？”
  // ===========================================================================
  console.log("[第一轮对话]");

  // 步骤 1：构造 HumanMessage（用户输入）
  const userMessage1 = new HumanMessage("你今天吃的什么？");

  // 步骤 2：把用户消息写入 history
  // history 内部数组从空变为 [HumanMessage]
  await history.addMessage(userMessage1);

  // 步骤 3：拼装 messages 数组
  // [systemMessage, ...(await history.getMessages())]
  // 当前 getMessages() 返回 [HumanMessage1]，所以 messages = [SystemMessage, HumanMessage1]，长度 = 2
  const messages1 = [systemMessage, ...(await history.getMessages())];

  // 步骤 4：调用模型
  // model.invoke 接收消息数组，返回一个 AIMessage
  const response1 = await model.invoke(messages1);

  // 步骤 5：把模型的回复写回 history
  // 这是“记忆”最关键的一步：少了它，下一轮模型就不知道前面说过什么
  // history 内部数组变为 [HumanMessage1, AIMessage1]
  await history.addMessage(response1);

  // 打印本轮对话（人眼观测）
  console.log(`用户: ${userMessage1.content}`);
  console.log(`助手: ${response1.content}\n`);

  // ===========================================================================
  // 第二轮对话：用户问“美味吗？” —— 模型应能基于第一轮回答作答
  // ===========================================================================
  console.log("[第二轮对话 - 基于历史记录]");

  // 步骤 1：构造第二个 HumanMessage
  const userMessage2 = new HumanMessage("好吃吗？");

  // 步骤 2：把用户消息写入 history
  // history 内部数组变为 [HumanMessage1, AIMessage1, HumanMessage2]
  await history.addMessage(userMessage2);

  // 步骤 3：拼装 messages 数组
  // getMessages() 返回 [HumanMessage1, AIMessage1, HumanMessage2]
  // 所以 messages2 = [SystemMessage, HumanMessage1, AIMessage1, HumanMessage2]，长度 = 4
  // 关键点：第二轮的 messages 已经“隐含”了第一轮的上下文，模型能据此作答
  const messages2 = [systemMessage, ...(await history.getMessages())];

  // 步骤 4：调用模型
  const response2 = await model.invoke(messages2);

  // 步骤 5：把第二轮的回复写回 history
  // history 内部数组最终变为 [HumanMessage1, AIMessage1, HumanMessage2, AIMessage2]
  await history.addMessage(response2);

  console.log(`用户: ${userMessage2.content}`);
  console.log(`助手: ${response2.content}\n`);

  // ===========================================================================
  // 兜底观测：打印完整历史，验证 history 真的在累积
  // ===========================================================================
  console.log("[历史消息记录]");
  const allMessages = await history.getMessages();
  console.log(`共保存了 ${allMessages.length} 条消息：`);
  // 遍历每条消息，打印其类型和前 50 字摘要
  // type='human' 显示“用户”，type='ai' 显示“助手”
  allMessages.forEach((msg, index) => {
    const type = msg.type;
    const prefix = type === "human" ? "用户" : "助手";
    console.log(
      `  ${index + 1}. [${prefix}]: ${msg.content.substring(0, 50)}...`,
    );
  });
}

// -----------------------------------------------------------------------------
// 4. 启动入口
// -----------------------------------------------------------------------------
// .catch(console.error)：把顶层异常打印出来，不让进程静默失败
inMemoryDemo().catch(console.error);

// =============================================================================
// 【设计模式总结】
// =============================================================================
//
// 本脚本采用“手动管理历史”模式（Manual Pattern），特点：
//
// ✅ 优点
//   - 控制力强：每一步都显式可见，调试方便
//   - 流程透明：能清楚看到 messages 是怎么从 system + history 拼出来的
//   - 适合学习：新人能直观理解 history 的累积过程
//
// ⚠️ 缺点
//   - 重复代码：每轮都要重复写 5 步，N 轮就是 5N 行
//   - 易遗漏：忘了 addMessage(response) 就“失忆”；把 SystemMessage 错加入 history 就“污染”
//   - 难扩展：多用户场景需要自己写 session_id → history 映射
//
// 📌 生产替代方案：RunnableWithMessageHistory（自动管理模式）
//
//   import { RunnableWithMessageHistory } from "@langchain/core/runnables";
//
//   const runnable = promptTemplate.pipe(model);
//   const withHistory = new RunnableWithMessageHistory({
//     runnable,
//     getMessageHistory: (sessionId) => store[sessionId], // 工厂函数
//     inputMessagesKey: "input",
//     historyMessagesKey: "history",
//   });
//
//   // 调用方只需要：
//   await withHistory.invoke(
//     { input: "好吃吗？" },
//     { configurable: { sessionId: "user-001" } },
//   );
//
// 区别：
//   - 手动 5 步 → 自动 1 步
//   - 但需要 getMessageHistory 工厂函数 + invoke 时传 sessionId
//   - 底层仍然依赖 BaseChatMessageHistory 实例
//
// 🔍 进阶话题（后续学习方向）
//   - trim_messages：截断早期消息，控制 token 消耗
//   - ConversationSummaryBufferMemory：用 LLM 摘要早期对话
//   - Redis/SQLite/PostgresChatMessageHistory：进程间共享 + 持久化
//   - Agent 工具调用多轮记忆：ToolMessage / FunctionMessage 类型
//
// =============================================================================
