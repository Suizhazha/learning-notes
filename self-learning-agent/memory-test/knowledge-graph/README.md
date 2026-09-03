# memory-test 知识图谱

存放本项目学习过程中沉淀的 **LangChain InMemoryChatMessageHistory 知识图谱**。当前锚点章节是 `src/history-test.mjs`（两轮多轮对话：手动管理 SystemMessage + HumanMessage + AIMessage 历史），整套图谱覆盖 LangChain 内存记忆的核心概念、消息类型、对话轮次处理、上下文传递机制以及设计模式（手动管理 vs RunnableWithMessageHistory 自动管理）。

## 文件清单

| 文件 | 角色 | 维护方式 |
|------|------|----------|
| `graph.json` | **单一事实源**，机器可读；定义节点 + 边 | 手编 |
| `graph.md` | Mermaid 渲染图谱 + 节点说明表，IDE 直接预览 | 手编，与 JSON 严格对齐 |
| `README.md` | 本文件，使用与维护说明 | — |

## 设计原则

- **JSON 是唯一事实源**：所有节点和边先在这里改，再同步到 `graph.md`
- **手动维护**：当前阶段每次新增 `.mjs` 时手动改 JSON；后续如频繁扩展可加 `scripts/regen-graph.mjs` 自动扫描
- **节点命名约定**：
  - `step.<动词>_<宾语>`：操作步骤，如 `step.compose_messages`
  - `concept.<名词>`：抽象概念，如 `concept.in_memory_history`
  - `param.<名字>`：关键参数 / 配置项，如 `param.temperature`
- **边关系**：
  - `前置`：流程上必须先做 A 才能做 B
  - `后置`：A 之后通常会做 B
  - `依赖`：A 在概念 / 参数上依赖 B
  - `对照`：A 与 B 是相似 / 互为反义的概念
  - `无依赖`：可独立并行（用虚线在 Mermaid 中表现）

## 节点字段说明

```json
{
  "id": "step.compose_messages",         // 全局唯一 ID，必须与命名约定一致
  "label": "拼装 messages 数组",          // 人类可读的中文短名
  "category": "step",                     // step | concept | param
  "summary": "…",                         // 1-2 句话简短说明
  "impl_file": "src/history-test.mjs",    // 在哪个 .mjs 里实现；未实现则为 null
  "impl_lines": "27, 39",                 // 在文件中的行号范围
  "api": "const messages = [systemMessage, ...history.getMessages()]"  // 对应 API 示例
}
```

## 边字段说明

```json
{
  "from": "step.compose_messages",        // 起点节点 ID
  "to": "step.invoke_model",              // 终点节点 ID
  "relation": "前置",                     // 前置 | 后置 | 依赖 | 对照 | 无依赖
  "note": "messages 拼好后才能 invoke"    // 一句话解释
}
```

## 更新流程（添加新 .mjs 后）

以新增 `src/history-with-runnable.mjs` 为例，它演示 `RunnableWithMessageHistory`。

1. **找到节点**：在 `graph.json` 中找到 `concept.design_pattern_auto`
2. **回填代码位置**：
   ```json
   {
     "id": "concept.design_pattern_auto",
     "impl_file": "src/history-with-runnable.mjs",
     "impl_lines": "1-60",
     ...
   }
   ```
3. **新增边（如果引入新的依赖关系）**：例如新脚本用了 getMessageHistory 工厂，可在 JSON `edges` 数组追加：
   ```json
   { "from": "step.runnable_invoke", "to": "concept.design_pattern_auto", "relation": "依赖", "note": "RunnableWithMessageHistory 自动管理 history" }
   ```
4. **同步 `graph.md`**：
   - 在"节点说明表"里更新该行的 `代码位置` 列
   - 如果新增了边，把它加入"边（关系）一览"表
   - 如有结构性变化（新增 subgraph / 流程节点），同步更新 Mermaid 块
5. **校验 JSON 合法**：
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('graph.json','utf8'))" && echo OK
   ```
   或运行完整校验：
   ```bash
   cat > /tmp/check-graph.cjs <<'EOF'
   const fs = require('node:fs');
   const g = JSON.parse(fs.readFileSync('graph.json','utf8'));
   const ids = new Set(g.nodes.map(n => n.id));
   const bad = g.edges.filter(e => !ids.has(e.from) || !ids.has(e.to));
   console.log('节点:', g.nodes.length, ' 边:', g.edges.length, ' 断边:', bad.length);
   EOF
   node /tmp/check-graph.cjs
   ```

## 添加全新操作（如 `src/trim-history.mjs`）

如果 `.mjs` 引入了一个 `graph.json` 里**还没有**的步骤（例如 `step.trim_messages` 截断早期消息），按以下步骤扩展：

1. 在 `graph.json` 的 `nodes` 数组追加新节点，遵循命名约定
2. 在 `edges` 数组追加它与上下游的边（至少一条 `前置` 边 + 一条与已存在概念的对照/依赖）
3. 在 `graph.md` 的 Mermaid `flowchart` 里：
   - 把新节点放进对应 subgraph
   - 用 `classDef` 已定义的样式（已有 `step`/`concept`/`param` 三类）
   - 把新边用 `A -->|relation| B` 加进去
4. 在 `graph.md` 的"节点说明表"和"边一览"中同步

## 当前覆盖范围（截至本次更新）

- **已落地的代码脚本**：
  - `src/history-test.mjs`：两轮多轮对话；手动管理 SystemMessage + HumanMessage + AIMessage；演示 InMemoryChatMessageHistory 累积
- **对话步骤（5 步法）**：init_model / init_history / build_system → add_human → compose_messages → invoke_model → add_ai → print_round → print_history
- **概念**：ChatMessageHistory / InMemoryChatMessageHistory / BaseMessage / HumanMessage / AIMessage / SystemMessage / Turn / ContextPassing / LLM / ModelInvoke / Lifecycle / ApiMethods / DesignPatternManual / DesignPatternAuto / SystemMessageStrategy / WindowBuffer / TokenGrowth / ComparisonPersistent
- **参数**：MODEL_NAME / OPENAI_API_KEY / OPENAI_BASE_URL / temperature

## 设计模式速查

| 模式 | 适用场景 | 关键 API | 记忆存储 | 备注 |
|------|---------|---------|---------|------|
| **手动管理**（本项目） | 单用户 demo / 单元测试 / 学习 | `history.addMessage / getMessages` | InMemoryChatMessageHistory | 显式 5 步，代码透明 |
| **RunnableWithMessageHistory 自动管理** | 多用户生产环境 / Web 后端 | `new RunnableWithMessageHistory({ runnable, getMessageHistory })` | InMemoryChatMessageHistory / Redis / SQLite / Postgres / Upstash | 按 session_id 自动读写；最常用 |

如需扩到更多内容（例如 `trim_messages` 截断窗口 / ConversationSummaryBufferMemory 摘要式记忆 / Agent 多轮工具调用记忆 / RunnableWithMessageHistory + Redis 持久化示例），按上述流程补充节点即可。
