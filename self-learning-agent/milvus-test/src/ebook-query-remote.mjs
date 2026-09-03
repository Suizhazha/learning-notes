import "dotenv/config";
import {
  MilvusClient, // Milvus SDK 客户端
  DataType,     // Milvus 字段类型枚举
  MetricType,   // 距离度量枚举
  IndexType,    // 索引类型枚举
} from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings } from "@langchain/openai";

const COLLECTION_NAME = "ebook_collection";
const VECTOR_DIM = 1024;

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

// ---------------- Milvus 客户端 ----------------
/**
 * 构造 Zilliz Cloud Serverless 客户端。
 *  - address: 公共 endpoint，形如 https://in03-xxxx.serverless.ali-cn-hangzhou.cloud.zilliz.com.cn
 *  - token:   ApiKey（控制台 → 集群详情 → API Key）
 *  - database: 数据库名（Serverless 默认 "default"，可建自定义 db）
 *  不需要 username/password；Serverless 用 token 直接鉴权。
 */
const client = new MilvusClient({
  address: process.env.MILVUS_ADDRESS,
  token: process.env.MILVUS_TOKEN,
  database: process.env.MILVUS_DB_NAME,
});

async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

async function main() {
  try {
    console.log("Connecting to Milvus...");
    await client.connectPromise;
    console.log("✓ Connected\n");

    // 确保集合已加载
    try {
      await client.loadCollection({ collection_name: COLLECTION_NAME });
      console.log("✓ 集合已加载\n");
    } catch (error) {
      // 如果已经加载，会报错，忽略即可
      if (!error.message.includes("already loaded")) {
        throw error;
      }
      console.log("✓ 集合已处于加载状态\n");
    }

    // 向量搜索
    console.log("Searching for similar ebook content...");
    const query = "赵云是使用什么武器？";
    console.log(`Query: "${query}"\n`);

    const queryVector = await getEmbedding(query);
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: 5,
      metric_type: MetricType.COSINE,
      output_fields: ["id", "book_id", "chapter_num", "index", "content"],
    });

    console.log(`Found ${searchResult.results.length} results:\n`);
    searchResult.results.forEach((item, index) => {
      console.log(`${index + 1}. [Score: ${item.score.toFixed(4)}]`);
      console.log(`   ID: ${item.id}`);
      console.log(`   Book ID: ${item.book_id}`);
      console.log(`   Chapter: 第 ${item.chapter_num} 章`);
      console.log(`   Index: ${item.index}`);
      console.log(`   Content: ${item.content}\n`);
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
