import "dotenv/config";

import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";

// ==============================
// 1. 初始化 Chat Model
// ==============================

const model = new ChatOpenAI({
  temperature: 0,

  model: process.env.MODEL_NAME,

  apiKey: process.env.OPENAI_API_KEY,

  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// ==============================
// 2. 初始化 Embedding Model
// ==============================

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,

  model: process.env.EMBEDDINGS_MODEL_NAME,

  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// ==============================
// 3. Puppeteer 加载掘金网页
// ==============================

const url = "https://juejin.cn/post/7233327509919547452";

const puppeteerLoader = new PuppeteerWebBaseLoader(url, {
  // 浏览器启动参数
  launchOptions: {
    // 学习 / 调试阶段建议 false
    // 可以直接看到 Chrome 打开网页
    headless: false,
  },

  // page.goto() 参数
  gotoOptions: {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  },

  // 自定义网页内容提取逻辑
  evaluate: async (page) => {
    // 等待 WAF 页面结束
    await page
      .waitForFunction(
        () => {
          return !document.body.innerText.includes("Please wait...");
        },
        {
          timeout: 30000,
        },
      )
      .catch(() => {
        console.log("等待 WAF 页面结束超时");
      });

    // 额外等待一会儿，让文章渲染
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 优先寻找文章正文节点
    const text = await page.evaluate(() => {
      const article =
        document.querySelector(".article-viewer") ||
        document.querySelector(".article-content") ||
        document.querySelector("article");

      // 找到正文就返回正文
      if (article) {
        return article.innerText;
      }

      // 找不到就返回整个 body，
      // 方便我们调试页面到底加载了什么
      return document.body.innerText;
    });

    return text;
  },
});

// ==============================
// 4. 加载网页
// ==============================

console.log("正在使用 Puppeteer 加载网页...");

const documents = await puppeteerLoader.load();

console.log(`documents.length: ${documents.length}`);

console.log(`Total characters: ${documents[0]?.pageContent?.length ?? 0}`);

// ==============================
// 5. 检查网页是否真正加载成功
// ==============================

const pageContent = documents[0]?.pageContent ?? "";

if (!pageContent.trim()) {
  throw new Error("网页加载失败：没有获取到正文内容");
}

if (pageContent.includes("WAFJS") || pageContent.includes("Please wait...")) {
  throw new Error("网页加载失败：当前获取到的仍然是 WAF 验证页面");
}

// 打印前 1000 字符检查一下
console.log("\n【网页正文预览】");

console.log(pageContent.slice(0, 1000));

// ==============================
// 6. 文本切分
// ==============================

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,

  chunkOverlap: 50,

  separators: ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
});

const splitDocuments = await textSplitter.splitDocuments(documents);

console.log(`\n文档分割完成，共 ${splitDocuments.length} 个分块`);

// ==============================
// 7. 打印分块结果
// ==============================

splitDocuments.forEach((doc, index) => {
  console.log(`\n========== Chunk ${index + 1} ==========`);

  console.log(doc.pageContent);
});

// ==============================
// 8. 创建向量存储
// ==============================

console.log("\n正在创建向量存储...");

const vectorStore = await MemoryVectorStore.fromDocuments(
  splitDocuments,
  embeddings,
);

console.log("向量存储创建完成");

// ==============================
// 9. 用户问题
// ==============================

const questions = ["父亲的去世对作者的人生态度产生了怎样的根本性逆转？"];

// ==============================
// 10. RAG
// ==============================

for (const question of questions) {
  console.log("\n" + "=".repeat(80));

  console.log(`问题: ${question}`);

  console.log("=".repeat(80));

  // ------------------------------
  // Retrieval
  // ------------------------------

  const scoredResults = await vectorStore.similaritySearchWithScore(
    question,
    2,
  );

  // ------------------------------
  // 输出检索结果
  // ------------------------------

  console.log("\n【检索到的文档及相似度评分】");

  scoredResults.forEach(([doc, score], i) => {
    console.log(`\n[文档 ${i + 1}] 相似度: ${score.toFixed(4)}`);

    console.log(`内容: ${doc.pageContent}`);

    if (doc.metadata && Object.keys(doc.metadata).length > 0) {
      console.log("元数据:", doc.metadata);
    }
  });

  // ------------------------------
  // 提取 Document
  // ------------------------------

  const retrievedDocs = scoredResults.map(([doc]) => doc);

  // ------------------------------
  // 构建 Context
  // ------------------------------

  const context = retrievedDocs
    .map(
      (doc, i) =>
        `[片段${i + 1}]
${doc.pageContent}`,
    )
    .join("\n\n━━━━━\n\n");

  // ------------------------------
  // Prompt
  // ------------------------------

  const prompt = `
你是一个文章辅助阅读助手。

请严格根据下面提供的文章片段回答问题。

如果提供的文章片段不足以回答问题，
请明确说明“当前检索到的文章片段不足以回答该问题”。

文章内容：

${context}

问题：

${question}

你的回答：
`;

  // ------------------------------
  // Generation
  // ------------------------------

  console.log("\n【AI 回答】");

  const response = await model.invoke(prompt);

  console.log(response.content);
}
