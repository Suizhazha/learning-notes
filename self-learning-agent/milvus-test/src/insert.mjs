/**
 * insert.mjs — Milvus 集合初始化 + Embedding 数据灌库示例
 *
 * 本脚本演示一条完整的"建集合 → 建索引 → 加载 → 向量化 → 插入"链路：
 *   1. 通过 OpenAI 兼容协议将 5 条中文日记转为 1024 维向量
 *   2. 在本地 Milvus（localhost:19530）中创建名为 ai_diary 的集合
 *   3. 为 vector 字段建立 IVF_FLAT + COSINE 索引
 *   4. 把集合加载到内存以便后续检索
 *   5. 把日记原文 + 向量一起插入集合
 *
 * 前置条件：
 *   - Milvus 服务已在 localhost:19530 监听（可通过 docker / milvus standalone 启动）
 *   - .env 中已配置 OPENAI_API_KEY / OPENAI_BASE_URL / EMBEDDINGS_MODEL_NAME
 *   - EMBEDDINGS_MODEL_NAME 输出的向量维度必须等于 VECTOR_DIM（1024）
 *
 * 运行：
 *   node src/insert.mjs
 */

// ---------------- 依赖引入 ----------------
import "dotenv/config"; // 把 .env 中的环境变量加载到 process.env
import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { OpenAIEmbeddings } from "@langchain/openai";

// ---------------- 常量定义 ----------------
const COLLECTION_NAME = 'ai_diary'; // 集合名，相当于 SQL 里的表名
const VECTOR_DIM = 1024; // 向量维度，必须与 EMBEDDINGS_MODEL_NAME 输出维度严格一致

// ---------------- Embedding 客户端 ----------------
/**
 * 构造一个 OpenAI 兼容协议的 Embedding 客户端。
 *  - apiKey / baseURL 来自 .env
 *  - dimensions: 1024 是 qwen text-embedding-v3 系列在 1024 维下的标准输出
 *    若模型默认输出不是 1024，必须显式指定，否则写入 Milvus 时会因 dim 不匹配报错
 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL
  },
  dimensions: VECTOR_DIM
});

// ---------------- Milvus 客户端 ----------------
/**
 * 构造 Milvus SDK 客户端。
 * address 格式为 host:port；本脚本连本地 standalone Milvus。
 * 客户端内部维护一个 connectPromise，调用方可通过 await 它来等待连接完成。
 */
const client = new MilvusClient({
  address: 'localhost:19530'
});

// ---------------- Embedding 工具函数 ----------------
/**
 * 把一段文本转成 1024 维向量。
 * @param {string} text - 待向量化的文本
 * @returns {Promise<number[]>} - 长度等于 VECTOR_DIM 的浮点数组
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

// ---------------- 主流程 ----------------
async function main() {
  try {
    // ---------- 1. 连接 Milvus ----------
    console.log('Connecting to Milvus...');
    // connectPromise 是 SDK 内部自动发起的连接握手；
    // await 它相当于"确保连接成功后"再继续，保证后续 RPC 不会因连接未就绪而失败
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ---------- 2. 创建集合（Collection） ----------
    console.log('Creating collection...');
    /**
     * createCollection 等价于 SQL 的 CREATE TABLE。
     * 一个集合由"字段（fields）+ 索引 + 加载状态"共同组成，本步只定义字段 schema。
     *
     * 字段类型说明：
     *   - VarChar      字符串（可指定 max_length）
     *   - FloatVector  浮点向量（必须指定 dim）
     *   - Array        数组（指定 element_type + max_capacity + 元素 max_length）
     *
     * 本集合 schema：
     *   id       主键（VarChar），业务侧自行生成 id 字符串
     *   vector   1024 维浮点向量，承载由 Embedding 模型生成的语义表示
     *   content  日记原文（用于检索后回显，避免二次查询）
     *   date     日期字符串
     *   mood     情绪标签
     *   tags     字符串数组（最多 10 个，每个最长 50 字符）
     */
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        { name: 'id', data_type: DataType.VarChar, max_length: 50, is_primary_key: true },
        { name: 'vector', data_type: DataType.FloatVector, dim: VECTOR_DIM },
        { name: 'content', data_type: DataType.VarChar, max_length: 5000 },
        { name: 'date', data_type: DataType.VarChar, max_length: 50 },
        { name: 'mood', data_type: DataType.VarChar, max_length: 50 },
        { name: 'tags', data_type: DataType.Array, element_type: DataType.VarChar, max_capacity: 10, max_length: 50 }
      ]
    });
    console.log('Collection created');

    // ---------- 3. 为向量字段建立索引 ----------
    console.log('\nCreating index...');
    /**
     * createIndex 等价于 SQL 的 CREATE INDEX。
     * 没有索引的向量字段只能做暴力搜索，IVF_FLAT / HNSW 等索引能极大加速近似最近邻（ANN）。
     *
     * 参数说明：
     *   index_type: IVF_FLAT  - 倒排文件 + 暴力精确距离；速度快、实现简单，适合中小规模
     *   metric_type: COSINE   - 用余弦相似度做距离度量；语义相似任务首选
     *   params.nlist: 1024    - 倒排聚类中心数量；经验值 ≈ sqrt(N) ~ 4*sqrt(N)
     *                            越大检索越慢但越精确，越小检索越快但召回下降
     */
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'vector',
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE,
      params: { nlist: 1024 }
    });
    console.log('Index created');

    // ---------- 4. 把集合加载到内存 ----------
    console.log('\nLoading collection...');
    /**
     * loadCollection 把集合从磁盘加载到 QueryNode 的内存中。
     * 加载后才能执行 search / query；插入数据本身不需要加载，
     * 但建好索引后通常会一并加载以备立即检索。
     * 数据量大时也可延迟到第一次 search 前再加载。
     */
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log('Collection loaded');

    // ---------- 5. 准备原始日记数据 ----------
    console.log('\nInserting diary entries...');
    /**
     * 5 条手工构造的中文日记样本，每条对应一行 Milvus 记录：
     *   id/content/date/mood/tags 是业务字段，最终会写入对应列；
     *   vector 字段将由下一步的 Embedding 生成。
     */
    const diaryContents = [
      {
        id: 'diary_001',
        content: '今天天气很好，去公园散步了，心情愉快。看到了很多花开了，春天真美好。',
        date: '2026-01-10',
        mood: 'happy',
        tags: ['生活', '散步']
      },
      {
        id: 'diary_002',
        content: '今天工作很忙，完成了一个重要的项目里程碑。团队合作很愉快，感觉很有成就感。',
        date: '2026-01-11',
        mood: 'excited',
        tags: ['工作', '成就']
      },
      {
        id: 'diary_003',
        content: '周末和朋友去爬山，天气很好，心情也很放松。享受大自然的感觉真好。',
        date: '2026-01-12',
        mood: 'relaxed',
        tags: ['户外', '朋友']
      },
      {
        id: 'diary_004',
        content: '今天学习了 Milvus 向量数据库，感觉很有意思。向量搜索技术真的很强大。',
        date: '2026-01-12',
        mood: 'curious',
        tags: ['学习', '技术']
      },
      {
        id: 'diary_005',
        content: '晚上做了一顿丰盛的晚餐，尝试了新菜谱。家人都说很好吃，很有成就感。',
        date: '2026-01-13',
        mood: 'proud',
        tags: ['美食', '家庭']
      }
    ];

    // ---------- 6. 并发生成向量 ----------
    console.log('Generating embeddings...');
    /**
     * 对每条日记的 content 调用 Embedding 模型，生成 1024 维向量。
     * Promise.all 让 5 次远程调用并行，平均延迟 ≈ 单次调用，而不是 5 次串行之和。
     * 返回的 diaryData 在原日记字段基础上多了一个 vector 字段，正好对齐 schema。
     */
    const diaryData = await Promise.all(
      diaryContents.map(async (diary) => ({
        ...diary,
        vector: await getEmbedding(diary.content)
      }))
    );

    // ---------- 7. 插入数据 ----------
    /**
     * insert 把一行行数据写入集合。
     * data 数组里的每个对象必须包含 schema 里全部字段（除 auto-id 外）；
     * 字段顺序无关，SDK 会按字段名匹配。
     * insert_cnt 是本次实际写入的行数。
     */
    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: diaryData
    });
    console.log(`✓ Inserted ${insertResult.insert_cnt} records\n`);

  } catch (error) {
    // 任意步骤失败都会进到这里；常见错误：连接失败 / dim 不一致 / 集合已存在 等
    console.error('Error:', error.message);
  }
}

main();