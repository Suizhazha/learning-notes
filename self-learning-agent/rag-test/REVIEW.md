# rag-test 快速复习

> 覆盖范围：`src/hello-rag.mjs`（RAG 全流程最小闭环）、`src/loader-and-splitter.mjs`（Cheerio 静态网页加载 + 切分）、`src/loader-and-splitter2.mjs`（Puppeteer 动态网页版，含 WAF 对抗）、`src/tiktoken-test.mjs`（tokenization 入门）。
> 前置关联：本目录是 memory-test 检索策略（Milvus 版 RAG）的"纯内存/教学版"，知识互补。

---

## 1. 一图流：RAG 的本质

```
知识在模型训练截止日期之后 / 私有 → 模型本来不会
         ↓
离线阶段（Indexing）:  文档 → 切分 chunk → embed 向量化 → 存 VectorStore
在线阶段（Query 时）:  问题 → embed → 相似度检索 top-k → 拼 Prompt → LLM 生成
         ↓
"开卷考试"：不更新模型参数，把参考资料塞进上下文
```

**一句话总结**：RAG = Retrieval（检索）+ Augmented（拼进 prompt 的上下文）+ Generation（LLM 基于片段作答）；`MemoryVectorStore.fromDocuments` + `asRetriever` / `similaritySearchWithScore` 是最小闭环三件套。

---

## 2. 核心速查表

| 概念 | 来源包 | 一句话 |
|------|--------|--------|
| `Document` | `@langchain/core/documents` | `{ pageContent: string, metadata: object }`，RAG 的最小知识单元 |
| `metadata` | — | 附加在 Document 上的结构化标签（chapter/character/type），检索时可过滤、答题时可溯源 |
| `MemoryVectorStore` | `@langchain/classic/vectorstores/memory` | 进程内存版向量库，重启即丢；适合学习/demo |
| `MemoryVectorStore.fromDocuments(docs, embeddings)` | — | 一步完成"逐条 embed + 入库"（Indexing 全部） |
| `vectorStore.asRetriever({ k })` | — | 把向量库包装成 Retriever（统一 `invoke(question)` 接口） |
| `retriever.invoke(question)` | — | 检索接口：问题 → 内部 embed → top-k Documents |
| `similaritySearchWithScore(q, k)` | — | 检索并带相似度评分，返回 `[Document, score][]`；**MemoryVectorStore 的 score 是距离，越小越相似**（打印时用 `1 - score` 换算成相似度） |
| `OpenAIEmbeddings` | `@langchain/openai` | 文本→向量；本配置走 DashScope `EMBEDDINGS_MODEL_NAME` |
| `RecursiveCharacterTextSplitter` | `@langchain/textsplitters` | 递归尝试分隔符列表切文本的切分器 |
| `CheerioWebBaseLoader` | `@langchain/community/.../web/cheerio` | HTTP 拉静态 HTML + CSS selector 提取（轻量、快） |
| `PuppeteerWebBaseLoader` | `@langchain/community/.../web/puppeteer` | 真实 Chrome 渲染后提取（重、慢、能过 JS 渲染） |
| `getEncoding` / `getEncodingNameForModel` | `js-tiktoken` | 模型名→编码名→token 计数器（`enc.encode(text).length`） |

两个模型的关系：`ChatOpenAI`（生成）与 `OpenAIEmbeddings`（向量化）是**两个独立模型**，分别由 `MODEL_NAME` / `EMBEDDINGS_MODEL_NAME` 配置，互不通用。

---

## 3. 必背流程

### hello-rag：RAG 五步法（离线 2 步 + 在线 3 步）

```js
// ---------- Indexing（离线，做一次）----------
// (1) 构造 Documents：知识 = pageContent + metadata
const documents = [new Document({ pageContent: "光光是一个...", metadata: { chapter: 1, ... } })];
// (2) 一句话建库：内部逐条调 embeddings 并存入内存
const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);
// ---------- Query（在线，每问一次）----------
// (3) 检索：asRetriever 包装，k=3 取最相关的 3 条
const retriever = vectorStore.asRetriever({ k: 3 });
const retrievedDocs = await retriever.invoke(question);
// (4) 拼 Prompt：把片段格式化成带编号的 context（━━━ 分隔），写清"没有就明说"的防幻觉指令
const prompt = `你是...基于以下故事片段回答...\n故事片段:\n${context}\n问题: ${question}`;
// (5) 生成
const response = await model.invoke(prompt);
```

- 最关键的是 (4)：**防幻觉指令**（"如果故事中没有提到，就说'这个故事里还没有提到这个细节'"）——不写这句，模型会用训练知识瞎编
- 带评分检索的两套写法：`retriever.invoke`（无 score）vs `similaritySearchWithScore`（有 score），hello-rag 两者都调了，用 `find` 按 pageContent 对齐把分数贴到 retriever 结果上

### loader-and-splitter：网页 → 切分 三步法

```js
// (1) 加载：Cheerio（静态）
const loader = new CheerioWebBaseLoader(url, { selector: ".article-content" });
const documents = await loader.load();        // → Document[]（metadata 含 source）
// (2) 切分
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400,        // 每块目标大小（字符）
  chunkOverlap: 50,      // 相邻块重叠，防止语义被切腰斩
  separators: ["。", "！", "？"],
});
const splitDocuments = await splitter.splitDocuments(documents);
// (3) 入库/检索（v2 才有）：fromDocuments → similaritySearchWithScore(question, 2)
```

- **Recursive 的含义**：按 separators **从前往后递归降级**——先试 `\n\n`（段落），切不下去（块仍 > chunkSize）再降级到 `\n`，再到 `。`，最后兜底 `""`（逐字符硬切）
- 中文必须自带标点分隔符列表（默认 separators 偏英文 `.\n`），否则整段无脑按长度硬切

### Puppeteer 版（loader-and-splitter2）多出的 4 件事

```js
new PuppeteerWebBaseLoader(url, {
  launchOptions: { headless: false },              // 调试时看得到浏览器
  gotoOptions: { waitUntil: "domcontentloaded", timeout: 60000 },
  evaluate: async (page) => {                       // ★ 自定义提取逻辑
    await page.waitForFunction(                     // ① 等 WAF 验证页消失
      () => !document.body.innerText.includes("Please wait..."),
      { timeout: 30000 },
    ).catch(() => console.log("等待 WAF 页面结束超时"));
    await new Promise(r => setTimeout(r, 3000));    // ② 再等 3s 渲染
    return page.evaluate(() => {                     // ③ 选择器降级链取正文
      const article = document.querySelector(".article-viewer")
        || document.querySelector(".article-content")
        || document.querySelector("article");
      return article ? article.innerText : document.body.innerText; // ④ 兜底整页（调试用）
    });
  },
});
// load 后还有防御校验：空文本 throw / 含 "WAFJS"、"Please wait..." throw
```

### tiktoken-test：token 不是字符

```js
const encodingName = getEncodingNameForModel("gpt-4");  // → "cl100k_base"
const enc = getEncoding("cl100k_base");
enc.encode("apple").length    // 英文词常 >1 token（BPE 子词切分）
enc.encode("苹果").length     // 中文常用字≈1-2 token/字
```

---

## 4. 横向对比表

### Cheerio vs Puppeteer（同抓一篇掘金文章，v1 vs v2）

| 维度 | CheerioWebBaseLoader（v1） | PuppeteerWebBaseLoader（v2） |
|------|---------------------------|------------------------------|
| 原理 | HTTP 拉原始 HTML + CSS selector | 启动真实 Chrome 渲染后取 innerText |
| JS 渲染/SPA | ❌ 拿不到 JS 后内容 | ✅ 等渲染完成 |
| 反爬 WAF | ❌ 可能拿到"Please wait..."验证页 | ✅ waitForFunction 等 WAF 过完 + 事后文本校验 |
| 资源占用 | 轻、快 | 重、慢（一个 Chrome 实例） |
| 提取方式 | `selector` 一项配置 | `evaluate(page)` 自定义函数，选择器可降级链 |
| chunkSize | 400 | 500 |
| 后续 | 只打印分块 | **继续建库 + 检索 + 生成**（完整 RAG） |
| 依赖 | cheerio | puppeteer（pnpm-workspace `allowBuilds.puppeteer: false` 管控其构建脚本） |

### 与 memory-test 检索策略对比

| | memory-test retrieval-memory | 本目录 hello-rag |
|---|---|---|
| 向量库 | Milvus（独立服务 :19530） | MemoryVectorStore（进程内） |
| 入库内容 | **每轮对话文本**（运行时产生） | **预置知识文档**（离线准备） |
| 检索目的 | 找回历史会话记忆（memory） | 找回领域知识（RAG） |
| 持久化 | ✅ 跨进程 | ❌ 重启即丢 |
| 共同点 | embed → COSINE 相似度 → 拼 context → invoke | 完全一致 |

---

## 5. 踩坑速查表

| # | 坑 | 正解 |
|---|----|------|
| 1 | **score 方向搞反**：MemoryVectorStore 的 score 是**距离**（越小越像），不是相似度 | 展示用 `1 - score`；换 Milvus 等库时注意各自 metric 的方向定义 |
| 2 | 中文用默认 separators 整块硬切 | 显式传 `separators: ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]`（从大到小降级） |
| 3 | chunkOverlap 理解错：不是"每个块多留 50 字" | 是**相邻块共享** 50 字重叠，保证跨块语义不断；代价是总 token 变多、可能重复片段入 top-k |
| 4 | Cheerio 抓掘金拿到的是 WAF 验证页 | 该站有 JS 反爬；换 Puppeteer + waitForFunction + 事后 `includes("Please wait...")` 校验 |
| 5 | Puppeteer `headless: true` 调试抓瞎 | 学习期 `headless: false`，亲眼看页面加载到哪一步 |
| 6 | `waitUntil: "networkidle0"` 长超时 | 用 `"domcontentloaded"` + 显式 sleep 组合，控制权更高（本项目写法） |
| 7 | selectors 单一选择器拿不到正文 | 降级链 `.article-viewer → .article-content → article → body.innerText`（body 兜底仅为调试） |
| 8 | 拿 chunkSize 400"字符"去估 token 成本 | 字符≠token，用 `js-tiktoken` 的 `enc.encode(text).length` 实测；中文尤甚 |
| 9 | 无 README/无 scripts 命令，靠 `node src/xxx.mjs` 运行 | `node src/hello-rag.mjs` 等；`tiktoken-test.mjs` 不需要 API Key，其余需要 .env |
| 10 | prompt 不写"没有就明说" | 模型拿训练期知识编造；两条 prompt（讲故事的老师/辅助阅读助手）都写了防幻觉兜底句 |

---

## 6. 运行速查

```bash
cd rag-test
pnpm install

# .env 需含（tiktoken-test 不需要）：
#   MODEL_NAME / EMBEDDINGS_MODEL_NAME / OPENAI_API_KEY / OPENAI_BASE_URL

node src/tiktoken-test.mjs          # 纯本地，无网络，零 Key
node src/hello-rag.mjs              # 需 Key；7 条预置故事入内存库，检索+生成
node src/loader-and-splitter.mjs    # 需网络（掘金）；Cheerio 拉文+切分，仅打印
node src/loader-and-splitter2.mjs   # 需网络+Key+本机 Chrome；Puppeteer 全流程 RAG

# 清理：本目录不产出持久化文件（MemoryVectorStore 全在内存）
# 首次装 puppeteer：workspace 已设 allowBuilds.puppeteer: false 拦截其安装脚本
```

技术栈：`@langchain/core`（Document）+ `@langchain/classic`（MemoryVectorStore）+ `@langchain/openai`（Chat + Embeddings）+ `@langchain/textsplitters`（切分）+ `@langchain/community`（Cheerio/Puppeteer loader）+ `js-tiktoken`（计数）+ `cheerio` / `puppeteer`。

---

## 7. 延伸知识点（联想区）

1. **Retriever 抽象层**：`asRetriever` 产出的是统一接口（`invoke`），可无缝接 LCEL 链 `createStuffDocumentsChain` / `createRetrievalChain`——手拼 prompt（本项目写法）→ 链式组合的下一步
2. **MultiQueryRetriever / ContextualCompressionRetriever**：前者用 LLM 把一个问题改写成多视角查询提召回，后者检索后再压缩/过滤片段；解决"一次 embed 表达不了用户意图"的问题
3. **切分策略生态**：`TokenTextSplitter`（按 token 而非字符）、`MarkdownTextSplitter`（按标题层级，对应笔记本类知识）、语义切分（embedding 相似度断句）；chunkSize/OVERLAP 调优是 RAG 效果的第一杠杆
4. **Embedding 模型选型**：`EMBEDDINGS_MODEL_NAME` 与 `dimensions`（memory-test 里 text-embedding-v3=1024）必须与**库中已存向量**一致，否则相似度全废；换模型=全量重建索引
5. **混合检索 Hybrid Search**：向量（语义）+ BM25（关键词）+ rerank（如 bge-reranker）三段式；中文专有名词/型号场景纯向量召回常翻车，对应 milvus-test 目录后续可实验
6. **Milvus 落地**：MemoryVectorStore 换 `Milvus.fromDocuments`（milvus-test 目录的 `rag.mjs` 就是这条线），接口一致；生产必备：filter（metadata 过滤）、partition、索引类型选型
7. **RAG 评估**：RAGAS（faithfulness/answer relevancy/context precision/recall 四指标）——"检索到的片段是否含答案、答案是否忠于片段"的量化版，对应本项目手看相似度分数的自动化
8. **进阶架构**：Agentic RAG（让 Agent 决定何时检索、检索什么、要不要再检索一次）——即 memory-test 延伸区的"工具化"思想：`retriever.invoke` 本身包成 tool 交给 Agent；再往后是 GraphRAG（知识图谱检索）与 memory-test 的 knowledge-graph 殊途同归
9. **chunk 元数据利用**：本项目 metadata 已带 chapter/character，但检索时没用——下一步可学 `asRetriever({ filter })` / self-query（LLM 把自然语言转 filter 表达式）

---

## 8. 自测清单（合上文档回答）

1. RAG 离线/在线两阶段各做哪几步？（离线：Document→embed→store；在线：embed→检索 top-k→拼 prompt→生成）
2. `MemoryVectorStore.fromDocuments(documents, embeddings)` 内部帮你省了哪几步？（逐条调 embed + 入库）
3. `asRetriever({ k: 3 })` 和 `similaritySearchWithScore(q, 3)` 返回值差在哪？（前者纯 Document[]；后者 [Document, score][]，且 score 是距离越小越像）
4. `Document` 的两个必填字段？（pageContent + metadata）
5. `RecursiveCharacterTextSplitter` 的 "Recursive" 什么意思？中文为什么要自己传 separators？（分隔符降级链；默认偏英文，中文会被硬切）
6. chunkOverlap=50 的作用和代价？（相邻块共享防断义；token 膨胀+可能重复入榜）
7. Cheerio 和 Puppeteer 抓同一篇掘金文章，各自会拿到什么？为什么 v2 要 waitForFunction？（Cheerio 可能拿 WAF 验证页；Puppeteer 等 "Please wait..." 消失，过 JS 反爬）
8. hello-rag 的 prompt 里那句防幻觉指令是什么、为什么必须有？（"故事中没有提到就明说"；否则模型用参数里的旧知识编）
9. "apple" 和 "苹果" 在 cl100k_base 下大约几个 token？说明什么？（BPE 子词，英文词可 >1；中文≈1-2/字；字符数≠token 数）
10. memory-test 的 retrieval-memory 和本目录 hello-rag 都是"embed→检索→拼 prompt"，本质区别？（入库对象：运行时对话 vs 离线知识文档；目标：恢复记忆 vs 注入知识）
