# memory-test

## 项目目标
- [x] 学习 LangChain `InMemoryChatMessageHistory` —— 进程内数组版对话历史管理
- [x] 学习 LangChain `FileSystemChatMessageHistory` —— 文件系统版持久化对话历史
- [x] 掌握"手动管理 5 步法"：构造消息 → addMessage → 拼 messages → invoke → addMessage(response)
- [x] 理解上下文传递机制：`[systemMessage, ...history.getMessages()]`
- [x] 理解 sessionId 多会话机制（持久化版本的"分区键"）
- [x] 与 `RunnableWithMessageHistory` 自动管理模式做对照（概念层）
- [ ] 后续：实践 `RunnableWithMessageHistory` + `FileSystemChatMessageHistory` 自动管理
- [ ] 后续：替换为 `RedisChatMessageHistory` / `SQLiteChatMessageHistory` 验证接口一致性

## 目录结构
```
memory-test/
├── src/                                   # 学习示例脚本（*.mjs）
│   ├── history-test.mjs                   # 内存版两轮多轮对话（5 步法）
│   └── history-test2.mjs                  # 文件版两轮多轮对话（5 步法 + 持久化扩展）
├── knowledge-graph/                       # 知识图谱（graph.json + graph.md + README.md）
├── .env                                   # 本地环境变量（不提交）
├── .env.example                           # 环境变量示例（可提交）
├── .gitignore
├── package.json
└── README.md
```

## 快速开始
```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入真实的 API Key / 模型名 / baseURL

# 3. 运行示例
pnpm history           # 内存版：node src/history-test.mjs
pnpm history:fs        # 文件版：node src/history-test2.mjs（会产生 chat_history.json）
pnpm history:debug     # 内存版 + Node Inspector
pnpm history:fs:debug  # 文件版 + Node Inspector

# 4. 验证持久化
cat chat_history.json  # 看完整 JSON 结构（顶层按 sessionId 分区）

# 5. 清理
rm chat_history.json   # 重置持久化历史
```

## 添加依赖
```bash
pnpm add <pkg>
```

## 学习笔记

### 核心结论（2026-09-03）
- **一句话总结**：`InMemoryChatMessageHistory` 和 `FileSystemChatMessageHistory` 实现的都是 `BaseChatMessageHistory` 接口（`addMessage / getMessages / clear`），业务代码只换 `new` 语句就能切换底层存储，零侵入。
- **手动 5 步法**（两个脚本一致）：`addMessage(HumanMessage)` → `messages = [system, ...history]` → `model.invoke(messages)` → `addMessage(AIMessage)` → `console.log`。
- **持久化扩展**：仅多 4 步——`resolve_filepath`（拼 filePath）→ `bind_session`（绑 sessionId）→ `open_history_persistent`（构造实例时立即从磁盘读）→ `print_persist_notice`（每轮打印"已保存"）。
- **设计模式对比**：手动管理=5 步透明但啰嗦；`RunnableWithMessageHistory`=1 步自动但需要工厂函数；生产环境通常后者。

### 踩坑 / 注意点
1. **文件名易错**：本目录所有脚本都以 `history-` 开头，不是 `memory-`。如果命令报 `Cannot find module '...src/memory-test.mjs'`，说明文件名打错了，正确命令是 `node src/history-test.mjs`（或 `pnpm history`）。
2. **SystemMessage 不进 history**：每轮 `[systemMessage, ...history.getMessages()]` 临时拼头部，不要把 SystemMessage 也 addMessage 进 history，否则会被算入 token 且无法动态换人格。
3. **temperature 必须为 0**：做"是否真的记住了上下文"的对照测试时，temperature=0 保证相同输入有相同输出，避免随机性干扰判断。
4. **ESM 下没有 `__dirname`**：用 `path.join(process.cwd(), '...')` 兜底；如果用 `__dirname`，要 `import.meta.url` + `fileURLToPath` 才能拿。
5. **FileSystem 版的并发写不安全**：单进程 OK，多进程 / 多实例并发写同一文件可能丢消息。生产请换 `SQLiteChatMessageHistory` 或 `RedisChatMessageHistory`。
6. **JSON 文件会无限增长**：本项目不演示，但如果用 FileSystem 版做长会话，需要在某个时机调用 `history.clear()` 或自己裁剪。

### 推荐演进路线
1. `history-test.mjs` → 内存版 5 步法 ✅ 已完成
2. `history-test2.mjs` → 文件版 5 步法 + sessionId ✅ 已完成
3. `history-test3.mjs` → 工厂函数 + RunnableWithMessageHistory 自动管理（推荐下一步）
4. `history-test4.mjs` → 切换 SQLite / Redis 持久化，对比接口一致性
5. `history-test5.mjs` → 引入 `trim_messages` 截断窗口，解决 token 线性增长

### 参考资料
- LangChain 官方文档：https://js.langchain.com/docs/modules/memory/
- `BaseChatMessageHistory` 接口：https://api.js.langchain.com/interfaces/langchain_core_chat_history.BaseChatMessageHistory.html
- `FileSystemChatMessageHistory` 源码：`node_modules/@langchain/community/dist/stores/message/file_system.d.ts`
- 本项目知识图谱：[knowledge-graph/graph.md](knowledge-graph/graph.md) / [knowledge-graph/README.md](knowledge-graph/README.md)
