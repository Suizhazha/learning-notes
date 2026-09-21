# memory-test 快速复习

> 覆盖范围：`src/history-test.mjs`（内存版）、`src/history-test2.mjs`（文件持久化版）、`src/memory/`（截断 / 摘要 / 检索三大策略）、`knowledge-graph/`（知识图谱）。
> 复习路径建议：先背"一图流"→ 再过 5 步法 → 再对比三种策略 → 最后看踩坑与延伸。

---

## 1. 一图流：记忆的本质

```
"记忆" = LLM 本身不存任何东西
         ↓
每一轮都把"历史消息数组"重新拼进 prompt
         ↓
messages = [SystemMessage, ...history.getMessages()]
         ↓
LLM 每次都是"无状态"的，状态全靠外部 history 维护
```

**一句话总结**：`InMemoryChatMessageHistory` 和 `FileSystemChatMessageHistory` 实现的都是 `BaseChatMessageHistory` 接口（`addMessage / getMessages / clear` 三件套），业务代码只换 `new` 语句就能切换底层存储，零侵入。

### 三种消息类型

| 类型 | type | 谁产生 | 进不进 history |
|------|------|--------|---------------|
| `HumanMessage` | `'human'` | 用户输入 | ✅ 进 |
| `AIMessage` | `'ai'` | `model.invoke()` 返回值，无需手动 import | ✅ 进 |
| `SystemMessage` | `'system'` | 业务代码构造的角色设定 | ❌ **不进**，每轮临时拼头部 |

SystemMessage 不进 history 的原因：① 会被算入历史 token；② 无法每轮动态换人格。

---

## 2. 手动管理 5 步法（必须背下来）

每一轮对话严格遵循：

```js
// (1) construct   构造用户输入
const userMessage = new HumanMessage("红烧肉怎么做");
// (2) addMessage  用户消息写入 history
await history.addMessage(userMessage);
// (3) compose     拼装 messages（SystemMessage 永远在头部）
const messages = [systemMessage, ...(await history.getMessages())];
// (4) invoke      调模型
const response = await model.invoke(messages);
// (5) addMessage  ★记忆最关键的一步：把回复写回 history
await history.addMessage(response);
```

关键观察：
- 每轮结束后 history 长度 **+2**（1 Human + 1 AI）；第 N 轮 messages 长度 = `2N + 1`（含 system）
- 第 (5) 步忘了写回 → 下一轮模型"失忆"
- `getMessages()` 是 **async** 的（FileSystem 版要从磁盘读），必须 `await`，漏了 messages 永远是空数组

---

## 3. 内存版 vs 文件持久化版

| 维度 | InMemoryChatMessageHistory | FileSystemChatMessageHistory |
|------|---------------------------|------------------------------|
| import 来源 | `@langchain/core/chat_history` | `@langchain/community/stores/message/file_system` |
| 构造 | `new InMemoryChatMessageHistory()` | `new FileSystemChatMessageHistory({ filePath, sessionId })` |
| 生命周期 | 进程退出即丢 | 写本地 JSON，重启仍存活 |
| 多会话 | ❌ 一个实例 = 一个会话 | ✅ 按 sessionId 分区 |
| 并发写 | 安全 | ❌ 无文件锁，多进程可能丢消息 |
| 适用 | demo / 单测 / 学习 | 单机持久化起步 |

**切换成本**：只有 1 行 import + 1 行 `new` 语句不同，其余 5 步法 1:1 对应——这就是 `BaseChatMessageHistory` 接口抽象的价值。

### FileSystem 版构造时内部做的 6 件事
1. 校验 `filePath` / `sessionId`（缺一抛 TypeError）
2. `readAll(path)`：`readFileSync` → `JSON.parse` → `Record<sessionId, Message[]>`（文件不存在初始化为 `{}`）
3. 取出本 sessionId 对应的 `Message[]`
4. `deserializeStoredMessage` 反序列化回 HumanMessage/AIMessage 实例
5. 暂存到内部 `Map<sessionId, BaseMessage[]>`
6. 此后 `addMessage`/`getMessages` 都在内存 Map 上做，最后**全量**异步写盘

### 持久化扩展的 4 个步骤（相对内存版新增）
1. `resolve_filepath`：`path.join(process.cwd(), "chat_history.json")`
2. `bind_session`：绑定 sessionId（分区键；生产应取自 JWT sub / userId / WebSocket 连接 ID）
3. `open_history_persistent`：`new` 实例时**立即从磁盘加载**旧消息（所以重跑脚本历史会自动恢复）
4. `print_persist_notice`：每轮打印"已保存"（持久化的可视化验证）

### chat_history.json 结构
```json
{
  "user_session_001": [
    { "type": "human", "data": { "content": "红烧肉怎么做", ... } },
    { "type": "ai",    "data": { "content": "...", "additional_kwargs": { "tool_calls": ... }, "response_metadata": { "token_usage": ... } } }
  ]
}
```
顶层 = `Record<sessionId, StoredMessage[]>`，所有会话共用一个文件。

---

## 4. 三大记忆管理策略（src/memory/）

未截断的 history 会导致 **token 线性增长**（每轮 +2 条），所以生产上必须做记忆管理。LangChain JS 常见三招：

### 策略 1：截断 Truncation（truncation-memory.mjs）
丢最早的，保最近的。

```js
// 按条数：最朴素
const trimmed = allMessages.slice(-maxMessages);

// 按 token：用官方 trimMessages + js-tiktoken
import { trimMessages } from "@langchain/core/messages";
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");
const trimmed = await trimMessages(messages, {
  maxTokens: 100,
  tokenCounter: async (msgs) => countTokens(msgs, enc),
  strategy: "last",           // 保留最近的消息
});
```

- token 计数：`encoder.encode(content).length`；content 可能是多模态数组，非 string 时先 `JSON.stringify`
- 优点：简单零成本；缺点：**早期信息永久丢失**（"我叫张三"被截掉后模型就忘了名字）

### 策略 2：摘要 Summarization（summarization-memory.mjs / 2）
旧消息不丢弃，而是用 LLM 压缩成摘要。

两种触发粒度：
- **按条数版**（v1）：`>= 6` 条触发，保留最近 2 条，其余总结
- **按 token 版**（v2）：总 token `>= 200` 触发；从后往前累加到 `keepRecentTokens = 80` 为止作为保留区，前面全部总结

核心流程（两版一致）：
```js
const recent = allMessages.slice(-keepRecent);
const toSummarize = allMessages.slice(0, -keepRecent);

// 1) 用 getBufferString 把消息数组转成 "用户: ...\n助手: ..." 文本
const conversationText = getBufferString(toSummarize, {
  humanPrefix: "用户", aiPrefix: "助手",
});
// 2) 让 LLM 总结
const summary = await model.invoke([
  new SystemMessage(`请总结以下对话的核心内容，保留重要信息：\n${conversationText}\n总结：`)
]);
// 3) 重建 history：clear → 只回填保留消息
await history.clear();
for (const msg of recent) await history.addMessage(msg);
```

- 对应 LangChain 经典 `ConversationSummaryBufferMemory` 的手动实现
- 优点：长期信息保住；缺点：每次总结多一次 LLM 调用（成本、延迟）
- ⚠️ 本示例的摘要没写回 history（打印后就丢了）——生产要把 summary 作为一条消息（或 SystemMessage）存回

### 策略 3：检索 Retrieval（retrieval-memory.mjs + insert-conversations.mjs）
不按时间丢，按**语义相关性**捞：每轮用当前问题做向量检索，从 Milvus 里捞最相关的历史对话拼进 prompt —— 这就是 **RAG 式记忆**。

流程（每轮）：
```
用户输入 → embedQuery 向量化
        → Milvus search(向量, top-k=2, COSINE)
        → 拼上下文: "相关历史对话：\n{...}\n\n用户问题: {input}"
        → model.invoke
        → addMessage(user + ai) 进 InMemory history
        → 本轮对话文本 "用户: ...\n助手: ..." 再 embedQuery → insert 进 Milvus
```

依赖（insert-conversations.mjs 一次性建库）：
```js
// 建集合：id(VarChar PK) + vector(FloatVector 1024) + content + round + timestamp
await client.createCollection({...});
// 建索引：IVF_FLAT + COSINE
await client.createIndex({...});
// 加载进内存（Milvus 搜索前必须 load）
await client.loadCollection({...});
// 批量插入：先生成向量再 insert
```

- Embeddings：`OpenAIEmbeddings`（DashScope `text-embedding-v3`，dimensions=1024）
- 优点：跨会话长期记忆、可扩展海量历史；缺点：依赖向量库基建 + 相似≠正确（可能捞回干扰上下文）
- 工程上常配合 filter（sessionId/时间）避免跨用户串记忆

### 三策略对比速查

| | 截断 | 摘要 | 检索 |
|---|---|---|---|
| 保留方式 | 最近 N 条/token | 旧消息压缩成摘要 | 语义相关的 top-k |
| 额外成本 | 0 | 每次触发 1 次 LLM 调用 | embedding + 向量检索 |
| 丢信息 | 早期全丢 | 摘要丢细节 | 不相关的捞不回 |
| 对应生态 | `trimMessages` / WindowBufferMemory | ConversationSummaryBufferMemory | VectorStoreRetrieverMemory |

---

## 5. 设计模式：手动 vs 自动

```js
// 手动 5 步 → 自动 1 步：RunnableWithMessageHistory
import { RunnableWithMessageHistory } from "@langchain/core/runnables";

const withHistory = new RunnableWithMessageHistory({
  runnable: promptTemplate.pipe(model),
  getMessageHistory: (sessionId) => new FileSystemChatMessageHistory({
    filePath, sessionId,               // 工厂函数：按 sessionId 分发 history
  }),
  inputMessagesKey: "input",
  historyMessagesKey: "history",
});

await withHistory.invoke(
  { input: "好吃吗？" },
  { configurable: { sessionId: "user-001" } },
);
```

- 手动：控制力强、流程透明，适合学习；缺点是重复代码、易遗漏、多用户要自己管 session 映射
- 自动：底层仍依赖 `BaseChatMessageHistory` 实例，只是把 5 步收进框架
- 多会话生产配方：`RunnableWithMessageHistory + 工厂函数 + sessionId 从登录态取`

---

## 6. 踩坑速查（考前必过）

| # | 坑 | 正解 |
|---|----|------|
| 1 | 文件名以 `history-` 开头不是 `memory-`；报 `Cannot find module` | `node src/history-test.mjs` 或 `pnpm history` |
| 2 | SystemMessage addMessage 进 history | 每轮临时拼头部，不入库 |
| 3 | 对照测试输出随机 | `temperature: 0` 保证可复现 |
| 4 | ESM 没有 `__dirname` | `path.join(process.cwd(), ...)` 或 `import.meta.url` + `fileURLToPath` |
| 5 | FileSystem 并发写丢消息 | 换 `SQLiteChatMessageHistory` / `RedisChatMessageHistory` |
| 6 | JSON 文件无限增长 | 适时 `history.clear()` 或自做截断/摘要 |
| 7 | 漏 `await history.getMessages()` | messages 是空数组 → 模型"失忆" |
| 8 | FileSystem 每次 addMessage **全量重写**文件 | 长会话高频写性能差，换 Redis/SQLite |
| 9 | JSON.parse 崩溃 | 上次进程写盘中断导致文件截断；删文件重来，生产加原子写（tmp+rename） |

### 典型异常分类
- **模型层**：401（Key/baseURL 不匹配）、404（MODEL_NAME 错）、429（限流）、NetworkError（代理拦截）
- **持久层**：EACCES（目录无写权限）、ENOENT（父目录不存在）、SyntaxError（文件截断）、EBUSY（Windows 文件占用）、EISDIR（路径传成目录）
- **业务层**：TypeError（构造漏传 filePath/sessionId）、失忆（漏 await）

---

## 7. 运行速查

```bash
cd memory-test
pnpm install && cp .env.example .env   # 填 MODEL_NAME / OPENAI_API_KEY / OPENAI_BASE_URL
pnpm history            # 内存版 5 步法
pnpm history:fs         # 文件版（产出 chat_history.json，重跑自动恢复历史）
node src/memory/truncation-memory.mjs          # 截断（无需 API Key）
node src/memory/summarization-memory.mjs        # 摘要 v1（按条数）
node src/memory/summarization-memory2.mjs       # 摘要 v2（按 token）
node src/memory/insert-conversations.mjs        # Milvus 建库+插数据（需本地 Milvus :19530）
node src/memory/retrieval-memory.mjs            # 检索记忆（需 Milvus）
pnpm graph:sync         # 知识图谱锚点 diff（@graph: 注释 ↔ graph.json）
pnpm graph:apply        # 回填行号 + 备份 graph.json.bak
```

技术栈：`@langchain/core`（消息/历史抽象）+ `@langchain/openai`（ChatOpenAI/OpenAIEmbeddings 走 DashScope 兼容端点）+ `@langchain/community`（FileSystem history）+ `js-tiktoken`（token 计数）+ `@zilliz/milvus2-sdk-node`（向量库）。

---

## 8. 知识图谱（学习基建）

`knowledge-graph/graph.json` 是**单一事实源**（41 节点 / 64 边），`graph.md` 是其 Mermaid 渲染。节点命名约定：`step.<动词>_<宾语>` / `concept.<名词>` / `param.<名字>`；边关系：前置 / 后置 / 依赖 / 对照 / 无依赖。

代码锚点：源码里 `// @graph: step.xxx` 单行注释 ↔ `scripts/sync-graph.mjs` 扫描回填 `impl_file/impl_lines`（`pnpm graph:sync` 只 diff，`--apply` 写盘前自动备份 + JSON 校验失败自动回滚）。

---

## 9. 延伸：Agent 记忆全景（联想知识点）

以上都是**短期会话记忆**。Agent 工程里完整的记忆体系是分层的：

```
┌─ 短期（本次对话）     ChatMessageHistory + 截断/摘要 ← 本项目已学
├─ 中期（跨会话/用户画像） 向量检索记忆(Retrieval) + 用户画像存储     ← retrieval-memory 已入门
├─ 长期（知识库）        RAG：文档 load → split → embed → 向量库      ← rag-test / milvus-test 目录
└─ 程序性记忆（技能）    把经验固化成 skill / 工具 / SOP             ← Qoder skills 即此思想
```

值得继续深挖的方向：

1. **ToolMessage / FunctionMessage**：Agent 工具调用循环里的第 4、5 种消息类型，工具结果要 addMessage 回 history 才能多轮推理（README 演进路线第 5 站之前必学）
2. **LangGraph memory**：LangChain 官方推荐的新一代状态管理——`StateGraph` 的 `checkpointer`（`MemorySaver` / `SqliteSaver` / `PostgresSaver`），按 `thread_id` 分区（概念对应本项目的 sessionId），支持**时间旅行**（从任意 checkpoint 重放）。`RunnableWithMessageHistory` 在 LangChain JS 1.x 已标记 deprecated，新项目建议直接学 LangGraph
3. **多模态/结构化消息**：`content` 为 `MessageContentComplex[]`（图片/文本块混合），token 计数和序列化都要特殊处理
4. **Mem0 / Letta(MemGPT) / Zep**：第三方记忆框架——把"记什么/忘什么"交给独立记忆层，支持事实抽取、冲突合并、遗忘曲线；比手写摘要策略更工程化
5. **Agent 自主记忆**：把 `history.addMessage` / 向量库写成**工具**交给 Agent 自己决定何时写入（写入即 ToolMessage），如 `memory_search` / `memory_write` 工具对
6. **token 高效化**：`trimMessages` 的 `strategy: "first"`（保开头，适合指令在头部）、`allow_partial`、`include_system`；prompt caching（KV cache 复用前缀，按前缀命中计费打折）
7. **评估记忆质量**：多轮一致性测试——temperature=0 固定输出后，"第 N 轮答案是否依赖第 1 轮信息"的自动化断言（本项目"好吃吗？"对照实验的产品化）
8. **sessionId 的工程边界**：一个用户多个话题该不该共享记忆？→ 引入 topic/thread 维度；memory 泄漏（A 用户检索到 B 用户向量）→ Milvus 加 `session_id` 标量字段 + filter 表达式

---

## 10. 自测清单（合上文档回答）

1. 5 步法是哪 5 步？哪一步漏了会"失忆"？哪一步省 token？（答：add_ai；system 拼头部不入库）
2. `FileSystemChatMessageHistory` 构造时发生什么？（读盘 → 按 sessionId 取段 → 反序列化 → 存 Map）
3. 内存版换文件版，代码改动几处？（2 处：import + new）
4. `trimMessages` 三要素？（maxTokens + tokenCounter + strategy）
5. 摘要策略里 `getBufferString` 干什么的？（消息数组 → "用户: / 助手: " 格式化文本，可自定义前缀）
6. 检索记忆每轮的输入输出各是什么？（入：用户问题；出：top-k 相似历史拼进 prompt；同时本轮对话向量化入库）
7. Milvus 检索前必须哪一步？（loadCollection；集合→索引→加载→才可 search）
8. `RunnableWithMessageHistory` 相比手动 5 步多了什么要求？（getMessageHistory 工厂 + configurable.sessionId）
9. token 为什么线性增长？三种策略各牺牲什么？（截断丢早期、摘要丢细节、检索捞不回不相关但可能串扰）
10. ESM 里拿当前目录的两种方式？（process.cwd() / import.meta.url + fileURLToPath）
