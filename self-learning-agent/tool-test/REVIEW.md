# tool-test 快速复习

> 覆盖范围：`src/` 8 个脚本——LangChain 工具定义（all-tools / tool-file-read）、**手写 Agent 工具循环**（tool-file-read / mini-cursor）、Node 子进程（node-exec）、**MCP 三部曲**（my-mcp-server 自建服务端 / langchain-mcp-test 单服务 / amap-mcp-test 多服务编排）。
> 产物目录：`react-todo-app/`（mini-cursor 生成的 TodoList）、`amap-tmp/`（高德酒店展示页）——它们是脚本运行结果，不是手写代码。
> 前置关联：memory-test 延伸区第 1 条 ToolMessage 在这里落地。

---

## 1. 一图流：Agent 的本质

```
Agent ≠ 更聪明的 LLM，Agent = LLM + 工具 + 循环
         ↓
┌──────────── ReAct 循环（本目录手写了两遍）────────────┐
│ messages → model.bindTools(tools).invoke(messages)   │
│   ├─ 无 tool_calls → 返回文本，循环结束              │
│   └─ 有 tool_calls → 执行工具 → ToolMessage 塞回     │
│                      messages → 再次 invoke ↺        │
└──────────────────────────────────────────────────────┘
状态（messages 数组）就是 memory-test 学的那套，只是多了 ToolMessage
```

**一句话总结**：Agent 的全部秘密就是一个 while 循环——LLM 决定"调什么工具"，业务代码执行"工具"并把结果用 ToolMessage 回填，直到 LLM 不再要工具为止；MCP 则把这个循环里的"工具层"标准化成跨进程协议。

---

## 2. 核心速查表

| 概念 | API | 说明 |
|------|-----|------|
| 定义工具 | `tool(asyncFn, { name, description, schema })` | `@langchain/core/tools`；schema 用 zod |
| 工具描述 | `description` + 每个字段 `.describe()` | **LLM 只靠这段文字决定何时调用**，写不好=不调用 |
| 绑定工具 | `model.bindTools(tools)` | 把工具定义转成模型的 function calling 协议 |
| 检测调用意图 | `response.tool_calls` | `[{ id, name, args }]`，无则循环结束 |
| 执行工具 | `foundTool.invoke(toolCall.args)` | LangChain Tool 实例自带 invoke |
| 回填结果 | `new ToolMessage({ content, tool_call_id })` | **tool_call_id 必须对应**，模型靠它配对请求/结果 |
| 多工具并行 | `Promise.all(tool_calls.map(invoke))` | tool-file-read 的写法；mini-cursor 是串行 for |
| MCP 服务端 | `McpServer` + `StdioServerTransport` | `@modelcontextprotocol/sdk` |
| MCP 注册工具 | `server.registerTool(name, { description, inputSchema }, handler)` | handler 返回 `{ content: [{ type: "text", text }] }` |
| MCP 注册资源 | `server.registerResource(名称, uri, { description, mimeType }, handler)` | 资源=可读数据（文档），工具=可执行动作 |
| MCP 客户端 | `MultiServerMCPClient({ mcpServers: {...} })` | `@langchain/mcp-adapters` |
| 拉取工具 | `await mcpClient.getTools()` | 返回 LangChain Tool 数组，**可直接 bindTools** |
| stdio 传输 | `{ command, args }` | 子进程启动，stdin/stdout 通信（本地工具） |
| Streamable HTTP 传输 | `{ url }` | 远程服务（高德 `https://mcp.amap.com/mcp?key=...`） |
| 子进程 | `spawn(cmd, args, { cwd, stdio: 'inherit', shell: true })` | node:child_process；close 事件拿退出码 |

---

## 3. 必背流程

### 3.1 定义一个工具（all-tools.mjs 模式）
```js
const readFileTool = tool(
  async ({ filePath }) => {
    try { return `文件内容:\n${await fs.readFile(filePath, 'utf-8')}`; }
    catch (e) { return `读取文件失败: ${e.message}`; }   // ★ 返回错误文本而不是 throw，LLM 能自我修正
  },
  { name: 'read_file',
    description: '读取指定路径的文件内容',               // ★ LLM 选工具的唯一依据
    schema: z.object({ filePath: z.string().describe('文件路径') }) },
);
```
四个内置工具：`read_file` / `write_file`（自动 `mkdir -p`）/ `execute_command`（spawn + shell）/ `list_directory`。

### 3.2 手写 Agent 循环（mini-cursor.mjs 骨架）★ 必背
```js
const modelWithTools = model.bindTools(tools);
for (let i = 0; i < maxIterations; i++) {           // ① 防死循环：上限 30
  const response = await modelWithTools.invoke(messages);
  messages.push(response);                            // ② AIMessage（含 tool_calls）也要进 history！
  if (!response.tool_calls?.length) return response.content;  // ③ 无工具调用 = 结束
  for (const toolCall of response.tool_calls) {
    const foundTool = tools.find(t => t.name === toolCall.name);
    const toolResult = await foundTool.invoke(toolCall.args); // ④ 执行
    messages.push(new ToolMessage({                  // ⑤ 回填
      content: toolResult,
      tool_call_id: toolCall.id,                     // ★ 必须，配对靠它
    }));
  }
}
```
两个脚本的差异：tool-file-read 用 `while (tool_calls.length > 0)` + `Promise.all` 并行执行；mini-cursor 用 `for + maxIterations` 上限 + 串行执行。**maxIterations 版更安全**。

### 3.3 自建 MCP Server（my-mcp-server.mjs）
```js
const server = new McpServer({ name: 'my-mcp-server', version: '1.0.0' });
server.registerTool('query_user', {
  description: '查询数据库中的用户信息...',
  inputSchema: { userId: z.string().describe('...') },   // ★ 注意：MCP SDK 用对象，不是 z.object()
}, async ({ userId }) => ({
  content: [{ type: 'text', text: `用户信息：...` }],    // ★ 固定格式 content 数组
}));
server.registerResource('使用指南', 'docs://guide', { description, mimeType }, async () => ({
  contents: [{ uri: 'docs://guide', text: '...' }],
}));
await server.connect(new StdioServerTransport());    // stdio：父进程经 stdin/stdout 通信
```

### 3.4 LangChain 连 MCP（langchain-mcp-test.mjs）
```js
const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "my-mcp-server": { command: "node", args: ["<绝对路径>/my-mcp-server.mjs"] },  // stdio
    "amap-maps-streamableHTTP": { url: "https://mcp.amap.com/mcp?key=" + KEY },  // HTTP
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", ...paths] },
    "chrome-devtools": { command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
  },
});
const tools = await mcpClient.getTools();   // → LangChain Tool[]
model.bindTools(tools);                     // 之后与 3.2 循环完全一致
// 资源侧：mcpClient.listResources() → readResource(serverName, uri)
await mcpClient.close();                    // ★ 用完关掉（杀子进程）
```

### 3.5 spawn 执行命令（node-exec.mjs / execute_command 工具内核）
```js
const [cmd, ...args] = command.split(' ');
const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true });
child.on('error', e => errorMsg = e.message);          // 启动失败（命令不存在）
child.on('close', code => code === 0 ? ok : fail);     // ★ 退出码在 close，不在 error
```

---

## 4. 横向对比表

### 四个 Agent 脚本的能力递进

| | tool-file-read | mini-cursor | langchain-mcp-test | amap-mcp-test |
|---|---|---|---|---|
| 工具来源 | 代码内定义（1 个） | 代码内定义（4 个） | MCP 单服务 | **MCP 4 服务编排** |
| 工具 | read_file | read/write/exec/list | query_user | 地图 + 文件系统 + Chrome 自动化 |
| 循环写法 | while + Promise.all 并行 | for + maxIterations 串行 | for + maxIterations | for + maxIterations |
| SystemMessage | ✅ 工作流程说明 | ✅ **工具使用规则**（cd 禁令） | ❌ 无 | ✅ **安全边界 + API 节流规则** |
| 实战规模 | 读一个文件解释 | **生成整个 React TodoList 项目** | 查用户 + 读资源 | 酒店→图片→开浏览器改标题 |
| ToolMessage 容错 | try-catch 返回 null | 直接 push | 直接 push | **content 类型归一化**（string / .text） |

### 手写工具 vs MCP 工具

| | 代码内 `tool()` | MCP Server |
|---|---|---|
| 进程 | 同进程函数 | 独立进程（stdio）/ 远程服务（HTTP） |
| schema | `z.object({...})` | `inputSchema: {...}` 对象（registerTool 展开） |
| 返回 | 任意 string | `{ content: [{ type, text }] }` 固定结构 |
| 复用 | 仅本项目 | 任何 MCP Client（Cursor / Claude / LangChain）都能连 |
| 适合 | 一次性/紧耦合逻辑 | 通用能力（地图、浏览器、文件系统）生态复用 |

### stdio vs Streamable HTTP 两种传输

| | `{ command, args }` | `{ url }` |
|---|---|---|
| 进程模型 | Client spawn 子进程，stdin/stdout 通信 | 连远程 HTTP 端点 |
| 适合 | 本地工具（filesystem / chrome-devtools / 自建） | 托管服务（高德地图） |
| 鉴权 | 进程级信任 | URL 带 key（本例）或 header token |
| 生命周期 | `close()` 杀子进程 | 断开 HTTP 连接 |

---

## 5. 踩坑速查表

| # | 坑 | 正解 |
|---|----|------|
| 1 | **漏 push AIMessage** | `messages.push(response)` 在检查 tool_calls **之前**——工具调用意图本身也是历史，漏了下一轮模型不知道自己调过什么 |
| 2 | **ToolMessage 漏 tool_call_id** | 多工具调用时模型无法配对结果 → 400 报错 |
| 3 | 工具里 throw 异常 | return 错误文本字符串，LLM 读到能自我修正重试 |
| 4 | **cd + workingDirectory 双重切换** | mini-cursor 的 SystemMessage 明令：`{ command: "pnpm install", workingDirectory: "react-todo-app" }` ✅，`cd xxx && pnpm install` + workingDirectory ❌（目录叠加找不到） |
| 5 | spawn 拿不到退出码 | 退出码在 `close` 事件；`error` 只覆盖"启动失败"；成功路径也 resolve 失败信息（exit code ≠ 0），不 reject |
| 6 | `command.split(' ')` 解析命令 | 简单命令够用；带引号/管道的命令靠 `shell: true` 兜底整条执行 |
| 7 | `stdio: 'inherit'` 看不到输出返回值 | inherit 是实时透传到控制台，工具拿不到 stdout 内容；要回传给 LLM 得用 pipe + 收集 |
| 8 | MCP registerTool 的 schema 传 `z.object()` | LangChain `tool()` 用 `schema: z.object()`；MCP SDK 用 `inputSchema: { userId: z.string() }` 平铺对象——两套不一样！ |
| 9 | MCP 工具返回普通字符串 | 必须 `{ content: [{ type: 'text', text }] }` 结构 |
| 10 | mcpClient 不 close | stdio 子进程泄漏；`await mcpClient.close()` |
| 11 | 硬编码绝对路径 `/Users/ynwa/...` | 脚本里写的是**另一位用户的家目录**（历史遗留），换机器要改 `args` 和 SystemMessage 里的路径 |
| 12 | 工具结果类型不定 | amap 版做了归一化：string 直接用 / 对象取 `.text`，否则 ToolMessage content 非法 |
| 13 | LLM 乱调 API / 乱写文件 | 学 amap 版的 SystemMessage：写入白名单目录、detail 限流（最多 3 个、间隔 1s、别批量）、禁止直接 navigate 图片 URL |
| 14 | 死循环烧钱 | 必须设 maxIterations；mini-cursor/amap 都用 30 |

---

## 6. 运行速查

```bash
cd tool-test
pnpm install
# .env：MODEL_NAME / OPENAI_API_KEY / OPENAI_BASE_URL / AMAP_MAPS_API_KEY（amap 版需要）

node src/hello-langchain.mjs        # 最小连通性测试（无工具）
node src/node-exec.mjs              # spawn 演示：⚠️ 会真的创建 react-todo-app 目录

node src/tool-file-read.mjs          # 单工具 + while 循环 Agent（读自己并解释）
node src/mini-cursor.mjs             # ⚠️ 大动作：创建 React TodoList 全项目并 pnpm install + dev

node src/my-mcp-server.mjs          # 只启动服务端（stdio 挂住等连接，不单独跑）
node src/langchain-mcp-test.mjs     # 连自建 MCP：查用户 002 + 列资源并读取
node src/amap-mcp-test.mjs          # ⚠️ 多服务：高德酒店→amap-tmp/*.html→开浏览器改标题
```
⚠️ 三个"有副作用"脚本（node-exec / mini-cursor / amap-mcp-test）会真实写磁盘、装依赖、开 Chrome——复习时先读代码理解流程，重跑前清理旧产物（react-todo-app/、amap-tmp/）。
依赖：`@langchain/core` + `@langchain/openai` + `@langchain/mcp-adapters` + `@modelcontextprotocol/sdk` + `zod`（+ chalk 被 mini-cursor/langchain-mcp/amap 三脚本 import 但未列进 package.json，属隐式依赖，新环境会报 Cannot find module）。

---

## 7. 延伸知识点（联想区）

1. **createReactAgent / LangGraph prebuilt**：手写 while 循环（本目录）的官方替代——LangGraph `createReactAgent(model, tools)`，内部是 StateGraph；与 memory-test 延伸区 LangGraph checkpointer 是同一生态，加个 check parameter 就有跨会话记忆
2. **多工具并行的取舍**：Promise.all 版（tool-file-read）快但结果顺序需小心对应 tool_call_id；串行 for 版稳。LangGraph 的 ToolNode 天然处理批量并行+错误路由
3. **MCP 三大原语**：本目录用了 tools + resources，还有第三种 **prompts**（服务端预置提示词模板，Client 可 list/get）；完整心智模型 = 工具（动作）+ 资源（数据）+ 提示（模板）
4. **传输协议演进**：stdio（本地）→ SSE（已弃用）→ **Streamable HTTP**（现行，高德用的就是）；remote MCP 还要考虑 OAuth 鉴权（amap 是 URL key 的简化版）
5. **安全边界工程化**：amap 版 SystemMessage 里的"写入白名单 + detail 限流 + 禁开图片 URL"本质是 prompt 层防护；生产还要加：工具层路径校验（resolve 后 prefix 检查）、命令白名单、确认机制（human-in-the-loop）——即 Qoder/Cursor 的权限系统在做什么
6. **Human-in-the-loop**：高危工具（execute_command）执行前挂起等用户确认——LangGraph `interrupt()` / Qoder 的权限弹窗；对照 mini-cursor 直接放行的风险
7. **子代理 SubAgent**：amap 版单循环挂 4 个 MCP 服务，工具一多选错率上升；解法 = 按领域拆多个 Agent（研究/编码/测试），主 Agent 路由分派（Qoder 的 Explore/Plan agent 即此模式）
8. **结构化工具结果**：ToolMessage 的 content 除 text 外还支持 `artifact`（大二进制不占上下文）、image 块；`stdio: 'inherit'` 拿不到输出的正解是 `stdio: 'pipe'` + 手动收集 stdout 再返回
9. **工具描述 = 提示工程**：本目录 description 都写了"何时调用"（"当用户要求读取文件时"）——工具调用的准确率一半取决于这段文字，一半取决于字段 `.describe()`；这是最容易被忽视的调优点

---

## 8. 自测清单（合上文档回答）

1. 手写 Agent 循环的 5 个关键动作？（invoke → push(AIMessage) → 检查 tool_calls → 执行工具 → push(ToolMessage) → 再 invoke，直到无调用）
2. 哪一步漏了 LLM 会失忆自己调过什么工具？（push AIMessage——tool_calls 意图也是历史）
3. ToolMessage 必填的两个字段？为什么 tool_call_id 不能漏？（content + tool_call_id；模型靠 id 配对哪个调用对应哪个结果）
4. 工具内部出错该 throw 还是 return？为什么？（return 错误文本；LLM 能读到并自我修正）
5. LangChain `tool()` 和 MCP `registerTool` 的 schema 写法差异？（`schema: z.object({...})` vs `inputSchema: { userId: z.string() }` 平铺）
6. MCP 工具的返回值固定结构？（`{ content: [{ type: 'text', text: '...' }] }`）
7. MCP 的两种传输方式及本目录的例子？（stdio=command/args：filesystem、chrome-devtools、自建 server；HTTP=url：高德）
8. MCP 工具如何进入 LangChain？（`MultiServerMCPClient.getTools()` → 普通 Tool[] → `bindTools`，与本地工具无差别）
9. spawn 拿退出码在哪个事件？error 和 close 的分工？（close；error=启动失败，close=执行结束带退出码）
10. mini-cursor 的 SystemMessage 为什么禁止 `cd` + workingDirectory 组合？（目录会叠加：workingDirectory 已切换，再 cd 找不到目标）
11. amap-mcp-test 的 SystemMessage 立了哪三类规矩？（文件写入白名单目录 / 高德 API 限流 / 浏览器禁开图片 URL 须生成 HTML）
12. maxIterations 为什么必须有？（防 LLM 无限调工具烧 token）
13. stdio: 'inherit' 的代价？（工具拿不到 stdout 内容回传给 LLM；要 pipe + 收集）
14. mcpClient 用完要做什么？为什么？（close()，杀掉 spawn 出来的子进程）
