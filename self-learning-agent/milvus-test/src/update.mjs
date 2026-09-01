// ---------------------------------------------------------------------------
// update.mjs —— Milvus "更新"数据示例
// ---------------------------------------------------------------------------
// 【重要认知】Milvus 没有原生 `client.update` —— "更新"是通过 **upsert**
// 实现的：
//
//   - 如果主键已存在 → 整行覆盖（包括向量、标量字段）
//   - 如果主键不存在 → 视同 insert
//
// 因此本文件名的 "update" 是业务语义，底层 API 是 `client.upsert`。
//
// 另一点要注意：**因为向量会被一起覆盖**，所以"更新文本"必须重新调用
// Embedding 生成新向量，否则向量与文本会失配（向量是旧的、文本是新的，
// 检索时按旧向量匹配，会召回错的内容）。
// ---------------------------------------------------------------------------

// 加载 .env
import "dotenv/config";
// Milvus SDK（这里不需要 MetricType，因为不检索）
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
// LangChain 的 OpenAI Embeddings（更新文本时需要重新生成向量）
import { OpenAIEmbeddings } from "@langchain/openai";

// ---------------------------------------------------------------------------
// 常量：与 insert.mjs / query.mjs / rag.mjs 保持一致
// ---------------------------------------------------------------------------
const COLLECTION_NAME = 'ai_diary';
const VECTOR_DIM = 1024;

// ---------------------------------------------------------------------------
// 初始化 Embeddings 客户端
// ---------------------------------------------------------------------------
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
const client = new MilvusClient({
  address: 'localhost:19530'
});

// ---------------------------------------------------------------------------
// 工具函数：把一段文本转成 1024 维向量
// ---------------------------------------------------------------------------
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

// ---------------------------------------------------------------------------
// 主流程：连接 → 准备新数据 → 重新 Embedding → upsert（实现"更新"）
// ---------------------------------------------------------------------------
async function main() {
  try {
    // 1) 等待 SDK 内部握手完成
    console.log('Connecting to Milvus...');
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ---------- 准备"更新后"的数据 ----------
    //
    // 这里把 id = 'diary_001' 那条原本"快乐散步"的日记改写成"孤独下雨"。
    // 关键点：
    //   - 必须沿用原 id（不然 upsert 会变成 insert 新行）
    //   - 所有标量字段都要给出（upsert 是"整行覆盖"，缺哪个字段哪个就成默认值）
    //   - vector 字段稍后用新文本重新生成
    console.log('Updating diary entry...');
    const updateId = 'diary_001';
    const updatedContent = {
      id: updateId,
      content: '今天下了一整天的雨，心情很糟糕。工作上遇到了很多困难，感觉压力很大。一个人在家，感觉特别孤独。',
      date: '2026-01-10',
      mood: 'sad',
      tags: ['生活', '散步', '朋友']
      // 注意：tags 这里是 ['生活','散步','朋友']，但内容是"下雨孤独"——
      // 这只是示例，生产场景下 tags 应该和 content 语义一致，否则会误导检索。
    };

    // ---------- 重新 Embedding ----------
    //
    // 重要：upsert 会用新向量替换旧向量。如果忘了这步、继续传旧 vector，
    // 会出现"文本已更新但检索召回的还是旧语义"的隐性 bug。
    console.log('Generating new embedding...');
    const vector = await getEmbedding(updatedContent.content);

    // 合并标量字段和新向量，得到完整的"待写入一行"
    const updateData = { ...updatedContent, vector };

    // ---------- upsert（实现"更新"） ----------
    //
    // client.upsert 行为：
    //   - 主键已存在 → 覆盖整行
    //   - 主键不存在 → 当成 insert 写入
    //
    // data 必须是数组（支持批量），数组里每个对象的字段名要与 schema 对齐。
    const result = await client.upsert({
      collection_name: COLLECTION_NAME,
      data: [updateData]
    });

    // 打印"更新结果"——result 通常包含 upsert_cnt / upsert_id（与 SDK 版本有关）
    console.log(`✓ Updated diary entry: ${updateId}`);
    console.log(`  New content: ${updatedContent.content}`);
    console.log(`  New mood: ${updatedContent.mood}`);
    console.log(`  New tags: ${updatedContent.tags.join(', ')}\n`);

    // ---------- 验证更新是否生效 ----------
    // 可以再用 query / get / search 看看效果：
    //
    //   const check = await client.get({
    //     collection_name: COLLECTION_NAME,
    //     ids: [updateId],
    //     output_fields: ['id', 'content', 'mood']
    //   });
    //   console.log(check);
    //
    // 或者用 search 验证：拿新文本做 query，看是否还能召回自己：
    //   const v = await getEmbedding(updatedContent.content);
    //   const r = await client.search({
    //     collection_name: COLLECTION_NAME,
    //     vector: v,
    //     limit: 1,
    //     metric_type: MetricType.COSINE,
    //     output_fields: ['id']
    //   });
    //   console.log(r.results[0]); // 期望 score 接近 1.0

  } catch (error) {
    // 常见错误：
    //   - "primary key not found"：updateId 不存在，upsert 会变成 insert；
    //     如果你期望"严格更新"，需要先 get 一下确保行存在
    //   - "dimension mismatch"：忘了重新 Embedding、传了旧向量
    //   - "field missing"：upsert 整行覆盖，缺字段会报错或写成默认值
    console.error('Error:', error.message);
  }
}

main();