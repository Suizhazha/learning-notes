// ---------------------------------------------------------------------------
// rag.mjs —— 基于 Milvus 的 RAG（检索增强生成）问答示例
// ---------------------------------------------------------------------------
// 【RAG 全流程】本文件把前面 insert.mjs（建库/灌库）和 query.mjs（向量检索）
// 的产物拼成一个完整的"问 → 答"闭环：
//
//   1) Embedding   —— 把用户问题转成 1024 维向量（同 query.mjs）
//   2) Retrieval   —— 在 Milvus 中向量检索 TopK 条相关日记（同 query.mjs）
//   3) Augment     —— 把检索结果拼成结构化 context，塞进 Prompt
//   4) Generation  —— 用 LLM（ChatOpenAI）基于 context 回答问题
//
// 关键点：LLM 自己并不知道用户的日记；它的"知识"完全来自第 2 步检索到的
// 日记片段。这是 RAG 与"裸 LLM 问答"最核心的区别。
// ---------------------------------------------------------------------------

// 加载 .env（OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME / EMBEDDINGS_MODEL_NAME）
import "dotenv/config";
// Milvus SDK：MilvusClient 是 RPC 客户端；MetricType 是度量方式枚举
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
// LangChain 的 LLM + Embeddings 双封装
// ChatOpenAI    —— 聊天补全模型（输出 text，response.content 是字符串）
// OpenAIEmbeddings —— 把文本转成定长浮点向量
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

// ---------------------------------------------------------------------------
// 常量定义：与 insert.mjs / query.mjs 必须保持一致
// ---------------------------------------------------------------------------
// 目标集合名：必须与 insert.mjs 中 createCollection 时使用的名字一致
const COLLECTION_NAME = 'ai_diary';

// 向量维度：必须与三处严格对齐：
//   1) insert.mjs 中 FloatVector 字段的 dim
//   2) OpenAIEmbeddings 的 dimensions
//   3) Embedding 模型实际输出的向量长度
const VECTOR_DIM = 1024;

// ---------------------------------------------------------------------------
// 初始化 LLM（生成侧）
// ---------------------------------------------------------------------------
// temperature = 0.7：中等随机性。回答类问题想要"自然但不失准"，通常用
// 0.3~0.7；如果是事实抽取 / 严格格式化场景，应降到 0~0.2。
const model = new ChatOpenAI({
  temperature: 0.7,
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// ---------------------------------------------------------------------------
// 初始化 Embeddings（检索侧）
// ---------------------------------------------------------------------------
// 注意：理论上"灌库"和"检索"应该使用同一个 Embedding 模型，否则两边的向量
// 空间不对齐，相似度就毫无意义。这里直接复用 query.mjs 的同一份配置。
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  },
  dimensions: VECTOR_DIM
});

// ---------------------------------------------------------------------------
// 初始化 Milvus 客户端
// ---------------------------------------------------------------------------
// 19530 是 Milvus standalone / embedded 的默认 gRPC 端口
const client = new MilvusClient({
  address: 'localhost:19530'
});

// ---------------------------------------------------------------------------
// 工具函数：把一段文本转成 1024 维向量
// ---------------------------------------------------------------------------
// embedQuery 是 LangChain 提供的"查询侧"Embedding 接口。
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * 检索阶段：从 Milvus 中拉回与问题最相关的 k 条日记
 *
 * @param {string} question 用户问题（自然语言）
 * @param {number} k        TopK，控制喂给 LLM 的"上下文条数"
 * @returns {Promise<Array>} 命中条目数组，每条形如
 *                            { id, score, content, date, mood, tags }
 *                            出错时返回 []，避免上层崩溃
 */
async function retrieveRelevantDiaries(question, k = 2) {
  try {
    // 1) 问题向量化：检索的前置步骤
    const queryVector = await getEmbedding(question);

    // 2) 在 Milvus 中做 ANN 检索（与 query.mjs 同款调用）
    //
    // 关键参数说明：
    //   collection_name —— 目标集合
    //   vector          —— 查询向量（单数；新版本 SDK 是 data: [vec]）
    //   limit           —— TopK；这里由上层传入，默认 2
    //   metric_type     —— COSINE（与建索引时一致）
    //   output_fields   —— 标量字段白名单；向量本身不会返回
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'content', 'date', 'mood', 'tags']
    });

    return searchResult.results;
  } catch (error) {
    // 检索失败时不要把异常往上抛——RAG 的常见策略是"降级到无上下文回答"
    console.error('检索日记时出错:', error.message);
    return [];
  }
}

/**
 * 生成阶段：把检索结果塞进 Prompt，让 LLM 基于日记内容回答
 *
 * @param {string} question 用户问题
 * @param {number} k        检索 TopK
 * @returns {Promise<string>} LLM 生成的最终回答；出错时返回兜底文案
 */
async function answerDiaryQuestion(question, k = 2) {
  try {
    console.log('='.repeat(80));
    console.log(`问题: ${question}`);
    console.log('='.repeat(80));

    // ---------- 1) 检索：拿 TopK 条相关日记 ----------
    console.log('\n【检索相关日记】');
    const retrievedDiaries = await retrieveRelevantDiaries(question, k);

    // 兜底：没有命中时不要强行让 LLM 编造答案
    if (retrievedDiaries.length === 0) {
      console.log('未找到相关日记');
      return '抱歉，我没有找到相关的日记内容。';
    }

    // ---------- 2) 打印检索到的日记，方便肉眼核对检索质量 ----------
    retrievedDiaries.forEach((diary, i) => {
      // score 在 COSINE 下是相似度（越大越像）；不要误读成"距离"
      console.log(`\n[日记 ${i + 1}] 相似度: ${diary.score.toFixed(4)}`);
      console.log(`日期: ${diary.date}`);
      console.log(`心情: ${diary.mood}`);
      console.log(`标签: ${diary.tags?.join(', ')}`);
      console.log(`内容: ${diary.content}`);
    });

    // ---------- 3) 增强（Augment）：把检索结果拼成结构化 context ----------
    //
    // 用 "[日记 N]" + 字段标签 + 分隔符的方式，让 LLM 容易"看出"每条日记
    // 的边界，避免把多条日记的内容混淆成一段。
    const context = retrievedDiaries
      .map((diary, i) => {
        return `[日记 ${i + 1}]
日期: ${diary.date}
心情: ${diary.mood}
标签: ${diary.tags?.join(', ')}
内容: ${diary.content}`;
      })
      .join('\n\n━━━━━\n\n');

    // ---------- 4) 拼装 Prompt ----------
    //
    // Prompt 设计要点：
    //   a) 角色设定：让 LLM 以"AI 日记助手"身份作答，语气更稳定
    //   b) 上下文显式给出：原样塞入 context
    //   c) 任务与约束：明确"基于日记"、"可总结多条"、"无相关就告知"
    //   d) 输出风格：第二人称"你"、有同理心
    //
    // 生产级 RAG 通常还会加：
    //   - 引用编号（要求 LLM 回答中标注 [日记 N]）
    //   - "如果信息不足请直说" 等反幻觉约束
    const prompt = `你是一个温暖贴心的 AI 日记助手。基于用户的日记内容回答问题，用亲切自然的语言。

请根据以下日记内容回答问题：
${context}

用户问题: ${question}

回答要求：
1. 如果日记中有相关信息，请结合日记内容给出详细、温暖的回答
2. 可以总结多篇日记的内容，找出共同点或趋势
3. 如果日记中没有相关信息，请温和地告知用户
4. 用第一人称"你"来称呼日记的作者
5. 回答要有同理心，让用户感到被理解和关心

AI 助手的回答:`;

    // ---------- 5) 生成（Generation）：调用 LLM 拿最终回答 ----------
    console.log('\n【AI 回答】');
    const response = await model.invoke(prompt);
    console.log(response.content);
    console.log('\n');

    return response.content;
  } catch (error) {
    console.error('回答问题时出错:', error.message);
    return '抱歉，处理您的问题时出现了错误。';
  }
}

// ---------------------------------------------------------------------------
// 主流程：连接 → 提问 → 检索 → 拼 prompt → LLM 回答
// ---------------------------------------------------------------------------
async function main() {
  try {
    // 等待 Milvus SDK 内部握手完成（connectPromise 在 MilvusClient 构造时即开始）
    console.log('连接到 Milvus...');
    await client.connectPromise;
    console.log('✓ 已连接\n');

    // 示例问题：问"我最近做了什么让我感到快乐的事情？"
    // k=2 表示检索 Top2 条日记喂给 LLM
    await answerDiaryQuestion("我最近做了什么让我感到快乐的事情？", 2);
  } catch (error) {
    console.error('错误:', error.message);
  }
}

main();