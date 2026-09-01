// ---------------------------------------------------------------------------
// query.mjs —— Milvus 向量检索（ANN Search）示例
// ---------------------------------------------------------------------------
// 【注意文件名】这个文件虽然叫 "query.mjs"，但它演示的并不是 Milvus 的
// `client.query`（那是基于标量字段过滤的精确查询）。本文件实际调用的是
// `client.search`，也就是 **向量检索 / ANN 检索**。在 Milvus SDK 中：
//
//   client.search       —— 向量检索，输入查询向量，返回 TopK 个最相似结果
//   client.query        —— 标量查询，输入 filter 表达式，按字段精确过滤
//   client.hybridSearch —— 混合检索，多向量 + rerank
//
// 文件名沿用了中文语境里"查询日记"的语义，但实际语义对应 search。
// ---------------------------------------------------------------------------

// 加载 .env 中的环境变量（OPENAI_API_KEY / OPENAI_BASE_URL / EMBEDDINGS_MODEL_NAME）
import "dotenv/config";
// Milvus SDK：MilvusClient 是 RPC 客户端；MetricType 是度量方式枚举
import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';
// LangChain 的 OpenAI Embeddings 封装：把文本转成定长浮点向量
import { OpenAIEmbeddings } from "@langchain/openai";

// ---------------------------------------------------------------------------
// 常量定义
// ---------------------------------------------------------------------------
// 目标集合名：必须与 insert.mjs 中 createCollection 时使用的名字一致，
// 否则会抛 "collection not found"。
const COLLECTION_NAME = 'ai_diary';

// 向量维度：必须与三处严格对齐：
//   1) insert.mjs 中 FloatVector 字段的 dim
//   2) 这里 OpenAIEmbeddings 的 dimensions
//   3) Embedding 模型实际输出的向量长度
// 任意一处不一致都会在 search 时报维度不匹配。
const VECTOR_DIM = 1024;

// ---------------------------------------------------------------------------
// 初始化 Embeddings 客户端
// ---------------------------------------------------------------------------
// OpenAIEmbeddings 内部会调用 OpenAI 的 /v1/embeddings 接口（如果 baseURL
// 被替换，可指向其他兼容 OpenAI 协议的服务，例如 Azure / OneAPI / Ollama
// 之类）。这里用 dimensions 强制约束输出维度为 1024。
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
// address 格式是 host:port，19530 是 Milvus standalone / embedded 的默认 gRPC 端口。
const client = new MilvusClient({
  address: 'localhost:19530'
});

// ---------------------------------------------------------------------------
// 工具函数：把一段文本转成 1024 维向量
// ---------------------------------------------------------------------------
// embedQuery 是 LangChain 提供的"查询侧"Embedding 接口（与 embedDocuments
// 是同一个底层调用，但在拆分 / 归一化策略上可能略有差异，官方建议
// 检索侧用 embedQuery，灌库侧用 embedDocuments，二者使用同一个模型即可）。
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

// ---------------------------------------------------------------------------
// 主流程：连接 → Embedding → 向量检索 → 打印结果
// ---------------------------------------------------------------------------
async function main() {
  try {
    // 1) 等待 Milvus SDK 内部握手完成
    console.log('Connecting to Milvus...');
    await client.connectPromise; // connectPromise 在 MilvusClient 构造时即开始握手
    console.log('✓ Connected\n');

    // 2) 准备查询文本
    //    这里的 query 是变量名（字符串），不是 SDK 的 query API。
    //    "我做饭或学习的日记" 会通过 Embedding 转成向量，
    //    再在 ai_diary 中找语义最接近的 TopK 条记录。
    console.log('Searching for similar diary entries...');
    const query = '我做饭或学习的日记';
    console.log(`Query: "${query}"\n`);

    // 3) 把查询文本 Embedding 成 1024 维向量
    const queryVector = await getEmbedding(query);

    // 4) 调用 client.search 做 ANN 检索
    //
    // 关键参数：
    //   collection_name —— 目标集合
    //   vector          —— 查询向量（单数）。注意：本项目使用的 SDK 版本
    //                      这里字段名是 vector（单数），新版本官方 SDK 已
    //                      改为 data: [vec]（数组，支持批量）。
    //   limit           —— TopK，即返回的最相似结果数（这里取 2）。
    //   metric_type     —— 度量方式，必须与建索引时的 metric_type 保持
    //                      一致（这里是 COSINE，余弦相似度；值越大越相似）。
    //   output_fields   —— 除了 id / score 外，额外返回哪些标量字段。
    //                      向量字段本身不会返回（节省带宽）。
    //
    // 返回结构：
    //   searchResult.results: [
    //     { id, score, <output_fields 中的字段> },
    //     ...
    //   ]
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: 2,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'content', 'date', 'mood', 'tags']
    });

    // 5) 打印结果
    console.log(`Found ${searchResult.results.length} results:\n`);
    searchResult.results.forEach((item, index) => {
      // score 在 COSINE 下是"相似度"（0~1，越大越像），
      // 不是距离——不要和 L2 下那种"越小越像"的 score 混淆。
      console.log(`${index + 1}. [Score: ${item.score.toFixed(4)}]`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Date: ${item.date}`);
      console.log(`   Mood: ${item.mood}`);
      // tags 在 schema 里是 Array 类型，所以是数组；用可选链 + join 防御空值
      console.log(`   Tags: ${item.tags?.join(', ')}`);
      console.log(`   Content: ${item.content}\n`);
    });

  } catch (error) {
    // 常见错误：
    //   - collection not found：未先跑 insert.mjs 建集合
    //   - dimension mismatch：VECTOR_DIM 与 schema 不一致
    //   - collection not loaded：未调用 loadCollection，或重启 Milvus 后未重新加载
    //   - metric type mismatch：检索 metric_type 与索引不一致
    console.error('Error:', error.message);
  }
}

// 启动主流程
main();