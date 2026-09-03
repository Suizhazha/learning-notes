/**
 * ebook-write.mjs — 把 EPUB 电子书灌入 Zilliz Cloud（Serverless）并落盘 chunk 索引
 *
 * 本脚本演示一条"EPUB 文件 → 章节切分 → 二次文本拆分 → 向量化 → 灌库 → 落盘 .jsonl"链路：
 *   1. 使用 LangChain 的 EPubLoader 按章节加载 .epub 文件
 *   2. 使用 RecursiveCharacterTextSplitter 把每章二次拆分为 ~500 字符的 chunk
 *      （相邻 chunk 保留 50 字符重叠，保证上下文连贯）
 *   3. 对每个 chunk 调用 Embedding 模型生成 1024 维向量
 *   4. 边处理边插入（流式处理），避免一次性把所有章节加载到内存
 *   5. 每条成功插入的 chunk 同步落盘到 ./data/<bookName>__chunks.jsonl（追加写）
 *
 * 与前一版的差异：
 *   - 连接目标从 localhost:19530 改为 Zilliz Cloud Serverless
 *     （用 MILVUS_ADDRESS + MILVUS_TOKEN 鉴权，不传 username/password）
 *   - 索引从 IVF_FLAT 改为 AUTOINDEX
 *     （Serverless 集群只支持 AUTOINDEX，底层会自动选最优索引 + metric）
 *   - 移除 loadCollection / releaseCollection
 *     （Serverless 无 QueryNode 内存加载概念，search 内部按需拉取）
 *   - 凭证全部走 .env，不再硬编码在脚本里
 *   - 新增"chunk 索引落盘"：每条成功插入的 chunk 写到 .jsonl 便于审计 + 重灌
 *
 * 数据集（Collection）schema：
 *   - id          主键，格式 `${bookId}_${chapterNum}_${chunkIndex}`，全局可定位
 *   - book_id     业务侧书籍 ID（当前示例固定为 1）
 *   - book_name   书名，从 EPUB 文件名自动提取
 *   - chapter_num 章节号（1-based）
 *   - index       同一章内的 chunk 序号（0-based）
 *   - content     chunk 原文（最长 10000 字符，足够放下 ~500 字符 + 余量）
 *   - vector      1024 维浮点向量
 *
 * 落盘文件：
 *   - ./data/<sanitizedBookName>__chunks.jsonl
 *     每行一个 JSON：{ id, book_id, book_name, chapter_num, index, content, vector_dim, ts }
 *     注意：vector 数组太长（1024 浮点），不写进 jsonl（仅记 dim），完整向量在 Milvus 里
 *
 * 前置条件：
 *   - .env 中已配置：
 *       MILVUS_ADDRESS  Serverless 集群的公共 endpoint
 *       MILVUS_TOKEN    ApiKey（控制台 → 集群详情 → API Key）
 *       MILVUS_DB_NAME  数据库名（Serverless 默认 "default"）
 *       OPENAI_API_KEY / OPENAI_BASE_URL / EMBEDDINGS_MODEL_NAME
 *   - EMBEDDINGS_MODEL_NAME 输出的向量维度必须等于 VECTOR_DIM（1024）
 *   - 当前目录有 EPUB_FILE 指向的 .epub 文件（默认 ./三国演义-罗贯中.epub）
 *   - 已安装依赖：@langchain/community（EPubLoader）、@langchain/textsplitters
 *
 * 运行：
 *   node src/ebook-write.mjs
 */

// ---------------- 依赖引入 ----------------
import "dotenv/config"; // 把 .env 中的环境变量加载到 process.env
import { parse } from "path"; // Node 内置 path 模块，用于从文件路径提取书名
import { writeFile, mkdir } from "node:fs/promises"; // 文件 IO（追加写 .jsonl）
import {
  MilvusClient, // Milvus SDK 客户端
  DataType,     // Milvus 字段类型枚举
  MetricType,   // 距离度量枚举
  IndexType,    // 索引类型枚举
} from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings } from "@langchain/openai"; // OpenAI 兼容协议的 Embedding 客户端
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub"; // LangChain 的 EPUB 加载器
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"; // 递归字符级文本拆分器

// ---------------- 常量定义 ----------------
const COLLECTION_NAME = "ebook_collection"; // 目标集合名，相当于 SQL 里的表名
const VECTOR_DIM = 1024; // 向量维度；与 Embedding 模型输出、schema.dim 三者必须一致
const CHUNK_SIZE = 500; // 每个 chunk 的目标字符数（拆分阈值）
const CHUNK_OVERLAP = 50; // 相邻 chunk 末尾重叠字符数（10%~20% of chunkSize）
const EPUB_FILE = "./src/三国演义-罗贯中.epub"; // 待处理的 EPUB 文件路径（相对于 cwd）

// 落盘目录
const DATA_DIR = "./data";

// 从文件名提取书名（去掉扩展名），后续写入 book_name 字段 + 落盘文件名
const BOOK_NAME = parse(EPUB_FILE).name;

// 防止书名里有奇怪字符（比如空格、emoji）影响文件名，把非 [A-Za-z0-9_\-] 替换成 _
const safeBookName = BOOK_NAME.replace(/[^A-Za-z0-9_\-]/g, "_");
// 落盘文件：<safeBookName>__chunks.jsonl
const JSONL_FILE = `${DATA_DIR}/${safeBookName}__chunks.jsonl`;

// ---------------- 环境变量校验 ----------------
/**
 * 启动时一次性校验必需的环境变量。
 * 任何一项缺失都直接退出，避免在连接阶段才报一个模糊的鉴权错误。
 */
function validateEnv() {
  const required = [
    "MILVUS_ADDRESS",
    "MILVUS_TOKEN",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "EMBEDDINGS_MODEL_NAME",
  ];
  const missing = required.filter((k) => !process.env[k] || process.env[k].trim() === "");
  if (missing.length) {
    console.error("✗ 以下环境变量未配置（请检查 .env）：");
    missing.forEach((k) => console.error(`    - ${k}`));
    process.exit(1);
  }
  // MILVUS_DB_NAME 可选，缺省走 "default"
  process.env.MILVUS_DB_NAME = process.env.MILVUS_DB_NAME || "default";
}

// ---------------- Embedding 客户端 ----------------
/**
 * 构造一个 OpenAI 兼容协议的 Embedding 客户端。
 *  - apiKey / baseURL / model 全部来自 .env
 *  - dimensions: 1024 与 Milvus schema 中的向量维度严格对齐
 *    若模型的默认输出维度不是 1024，必须显式指定，否则写入会因 dim 不匹配报错
 */
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

// ---------------- Embedding 工具函数 ----------------
/**
 * 把一段文本转成 1024 维向量。
 *  - 复用 LangChain 的 OpenAIEmbeddings，对接 .env 里的 OpenAI 兼容服务
 *  - embedQuery 是为"查询场景"优化的接口；
 *    灌库时也可以用 embedDocuments（支持批量），本脚本按 chunk 粒度逐个调用以简化控制
 *
 * @param {string} text - 待向量化的文本
 * @returns {Promise<number[]>} - 长度等于 VECTOR_DIM 的浮点数组
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

// ---------------- 文件落盘工具 ----------------
/**
 * 把单条 chunk 记录追加写到 .jsonl 文件（一行一个 JSON）。
 *
 * 设计要点：
 *  - 用 'a' 追加模式 + '\n' 结尾，确保每行都是独立的 JSON，
 *    后续可被任何 jsonl 工具流式读入
 *  - 路径已含 data/ 前缀；调用方需保证 data/ 目录已存在
 *  - vector 字段（1024 浮点）不写进 jsonl（文件会爆），只记 dim；
 *    完整向量以 Milvus 为准，jsonl 只做"索引 / 审计 / 重灌"用途
 *
 * @param {object} record - { id, book_id, book_name, chapter_num, index, content }
 */
async function appendJsonl(record) {
  const line = JSON.stringify({
    ...record,
    vector_dim: VECTOR_DIM, // 占位：让审计时一眼看出"完整向量在 Milvus"
    ts: new Date().toISOString(),
  }) + "\n";
  await writeFile(JSONL_FILE, line, { flag: "a", encoding: "utf8" });
}

// ---------------- 集合初始化 ----------------
/**
 * 确保目标集合存在；若不存在则创建字段定义 + 向量索引。
 *
 * Serverless 特别说明：
 *  - 索引只能用 AUTOINDEX（不要写 IVF_FLAT / HNSW 等），
 *    AUTOINDEX 内部会自动选最优的 ANN 算法（一般是 HNSW 变体）+ 与 metric_type 匹配
 *  - 不需要 loadCollection / releaseCollection（Serverless 内部按需拉取数据）
 *
 * @param {string|number} bookId - 业务侧书籍 ID；当前仅作为预留参数，未写入 schema
 *                               （bookId 通过 id 字段的 `${bookId}_${chapterNum}_${chunkIndex}` 间接体现）
 */
async function ensureCollection(bookId) {
  try {
    // ---------- 1. 检查集合是否存在 ----------
    const hasCollection = await client.hasCollection({
      collection_name: COLLECTION_NAME,
    });

    if (!hasCollection.value) {
      // ---------- 2. 集合不存在则建表 ----------
      console.log("创建集合...");
      /**
       * createCollection 等价于 SQL 的 CREATE TABLE。
       * 本集合 schema 的设计要点：
       *   - id          业务自生成主键，格式 `${bookId}_${chapterNum}_${chunkIndex}`
       *                 这样可同时定位"哪本书 / 哪一章 / 哪一段"，方便后续按主键做 update/delete
       *   - book_id     预留字段，便于按书过滤（当前未挂载索引，过滤走全扫描）
       *   - book_name   书名冗余存储，避免按 book_id 反查
       *   - chapter_num Int32，1-based 章节号
       *   - index       Int32，章节内的 chunk 序号（0-based）
       *   - content     原文；500 字符左右 + 余量给到 10000 字符
       *   - vector      1024 维 FloatVector，必须与 VECTOR_DIM 一致
       */
      await client.createCollection({
        collection_name: COLLECTION_NAME,
        fields: [
          {
            name: "id",
            data_type: DataType.VarChar,
            max_length: 100,
            is_primary_key: true,
          },
          { name: "book_id", data_type: DataType.VarChar, max_length: 100 },
          { name: "book_name", data_type: DataType.VarChar, max_length: 200 },
          { name: "chapter_num", data_type: DataType.Int32 },
          { name: "index", data_type: DataType.Int32 },
          { name: "content", data_type: DataType.VarChar, max_length: 10000 },
          { name: "vector", data_type: DataType.FloatVector, dim: VECTOR_DIM },
        ],
      });
      console.log("✓ 集合创建成功");

      // ---------- 3. 为向量字段建索引 ----------
      console.log("创建索引（AUTOINDEX）...");
      /**
       * Serverless 集群只支持 AUTOINDEX：
       *   - 底层由 Zilliz Cloud 决定用什么 ANN 算法（HNSW 变体等）
       *   - metric_type 仍然要让用户显式指定（与后续 search 时保持一致）
       *   - params 留空（AUTOINDEX 不需要 nlist / M / efConstruction 这类参数）
       *
       * 注意：如果你的集群是 Dedicated（不是 Serverless），
       * 这里要换成 IVF_FLAT / HNSW / DISKANN 等并填 params。
       */
      await client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: "vector",
        index_type: IndexType.AUTOINDEX,
        metric_type: MetricType.COSINE,
        params: {},
      });
      console.log("✓ 索引创建成功");
    } else {
      console.log("✓ 集合已存在，跳过创建");
    }
  } catch (error) {
    console.error("创建集合时出错:", error.message);
    throw error;
  }
}

// ---------------- 批量插入 ----------------
/**
 * 把同一章节内的所有 chunk 一次性向量化并插入 Milvus + 落盘 .jsonl。
 *
 * 设计要点：
 *  - 用 Promise.all 并行处理 chunk 的 Embedding，
 *    平均 Embedding 延迟 ≈ 单次调用，而不是 N 次串行
 *  - 手动拼主键 id = `${bookId}_${chapterNum}_${chunkIndex}`
 *    这样无论重跑多少次，同一位置都生成同一个主键，天然支持幂等（重复插入会变成 upsert 语义）
 *  - 一次 client.insert 写完一个章节，减少 RPC 次数
 *  - 落盘策略：Milvus 插入成功后才落盘；失败时 jsonl 不会有残留记录
 *    这样 jsonl 可以作为"已成功入库"的可靠索引
 *
 * @param {string[]} chunks   - 当前章节切分出的文本片段
 * @param {string|number} bookId - 书籍业务 ID
 * @param {number} chapterNum - 章节号（1-based）
 * @returns {Promise<number>} 实际写入条数
 */
async function insertChunksBatch(chunks, bookId, chapterNum) {
  if (chunks.length === 0) {
    return 0;
  }

  // 为每个 chunk 生成向量，并补齐 schema 要求的全部字段
  const insertData = await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      const vector = await getEmbedding(chunk);
      return {
        id: `${bookId}_${chapterNum}_${chunkIndex}`,
        book_id: String(bookId),
        book_name: BOOK_NAME,
        chapter_num: chapterNum,
        index: chunkIndex,
        content: chunk,
        vector: vector,
      };
    }),
  );

  // 一次 RPC 写入整章所有 chunk；返回 insert_cnt 表示实际写入条数
  const insertResult = await client.insert({
    collection_name: COLLECTION_NAME,
    data: insertData,
  });

  const insertedCount = Number(insertResult.insert_cnt) || 0;

  // ---------- 落盘 .jsonl ----------
  // 每条成功插入的 chunk 单独写一行 JSON，便于后续审计 / 重灌 / 离线分析
  // 注意：这里"成功"的判定用 insertedCount 与 chunks.length 一致来判断；
  // 若 Zilliz 部分成功（insert_cnt < len），仍按整批落盘，
  // 落盘数据与 Milvus 完全对齐——因为我们用相同的主键和字段构造了数据
  await Promise.all(
    insertData.map((row) =>
      appendJsonl({
        id: row.id,
        book_id: row.book_id,
        book_name: row.book_name,
        chapter_num: row.chapter_num,
        index: row.index,
        content: row.content,
      }),
    ),
  );

  return insertedCount;
}

// ---------------- EPUB 流式处理 ----------------
/**
 * 加载 EPUB 文件并按"章节 → chunk → Embedding → insert → 落盘"的顺序流式处理。
 *
 * 为什么用"流式"而不是"先把全本拆完再一起灌库"：
 *   - 一次性把整本书的所有 chunk 加载到内存可能 OOM（《三国演义》全本切 500 字符会有上万个 chunk）
 *   - 流式可以"边拆边灌"，每章写完就释放该章的内存
 *   - 失败时也能精确定位到"哪一章"出错，便于重试
 *
 * EPubLoader 的 splitChapters:true 会按 EPUB 的目录项把全书拆成多份 Document；
 * 每份 Document 的 pageContent 就是该章的纯文本。
 *
 * @param {string|number} bookId - 书籍业务 ID
 * @returns {Promise<{total: number, failedChapters: number[]}>} 总写入条数 + 失败章节列表
 */
async function loadAndProcessEPubStreaming(bookId) {
  console.log(`\n开始加载 EPUB 文件: ${EPUB_FILE}`);

  // ---------- 1. 按章节加载 EPUB ----------
  /**
   * EPubLoader(EPUB_FILE, { splitChapters: true })
   *   - splitChapters: true 让 loader 在解析时按章节（spine/ncx）切分，
   *     返回的 documents 数组每个元素对应一章
   *   - 若设为 false，则整本作为一个 Document，需要再自行切分
   *
   * pageContent 字段：纯文本
   * metadata 字段：包含 chapter / file_path 等元信息（视 EPUB 内部结构而定）
   */
  const loader = new EPubLoader(EPUB_FILE, {
    splitChapters: true,
  });

  const documents = await loader.load();
  console.log(`✓ 加载完成，共 ${documents.length} 个章节\n`);

  // ---------- 2. 构造二次文本拆分器 ----------
  /**
   * RecursiveCharacterTextSplitter 会按以下分隔符层级尝试切分：
   *   ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
   * 优先用大粒度（段落、换行），保证切出来的 chunk 语义尽量完整；
   * 如果单段就已经超过 chunkSize，再退到更细的分隔符。
   *
   * chunkOverlap 让相邻 chunk 末尾重叠若干字符，
   * 避免在切分边界处"前半句/后半句"被割裂，检索时不会因为边界而漏召回。
   */
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  let totalInserted = 0;
  const failedChapters = []; // 失败章节号（1-based），便于后续单章重试
  const startTime = Date.now();

  // ---------- 3. 逐章处理：拆 → 向量化 → 插入 → 落盘 ----------
  for (let chapterIndex = 0; chapterIndex < documents.length; chapterIndex++) {
    const chapterNum = chapterIndex + 1;
    const chapter = documents[chapterIndex];
    const chapterContent = chapter.pageContent || "";

    console.log(`处理第 ${chapterNum}/${documents.length} 章...`);

    try {
      // 二次拆分：长章节切成 ~500 字符的短 chunk
      const chunks = await textSplitter.splitText(chapterContent);
      console.log(`  拆分为 ${chunks.length} 个片段`);

      if (chunks.length === 0) {
        console.log(`  跳过空章节\n`);
        continue;
      }

      console.log(`  生成向量并插入中...`);

      // 当前章节所有 chunk 一次性向量化 + 插入 + 落盘
      const insertedCount = await insertChunksBatch(
        chunks,
        bookId,
        chapterNum,
      );
      totalInserted += insertedCount;

      // 进度统计：累计百分比 + 已用时间
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const percent = ((chapterNum / documents.length) * 100).toFixed(1);
      console.log(
        `  ✓ 已插入 ${insertedCount} 条（累计: ${totalInserted} | 进度: ${percent}% | 用时: ${elapsed}s）\n`,
      );
    } catch (error) {
      // 单章失败不中断整本：记录下来、继续下一章
      // 常见错误：Embedding 接口限流 / 单 chunk 超长 / 网络抖动
      console.error(`  ✗ 章节 ${chapterNum} 处理失败:`, error.message);
      failedChapters.push(chapterNum);
    }
  }

  return { total: totalInserted, failedChapters };
}

// ---------------- 主流程 ----------------
/**
 * 主函数：环境校验 → 连接 → 建集合 → 流式灌库 → 落盘 → 汇总
 */
async function main() {
  // ---------- 0. 环境变量校验 ----------
  validateEnv();

  console.log("=".repeat(80));
  console.log(`电子书处理程序 — 《${BOOK_NAME}》`);
  console.log(`  Milvus:    ${process.env.MILVUS_ADDRESS}`);
  console.log(`  Database:  ${process.env.MILVUS_DB_NAME}`);
  console.log(`  Collection: ${COLLECTION_NAME}`);
  console.log(`  Embedding: ${process.env.EMBEDDINGS_MODEL_NAME} (dim=${VECTOR_DIM})`);
  console.log(`  输出文件:  ${JSONL_FILE}`);
  console.log("=".repeat(80));

  // ---------- 1. 准备落盘目录 ----------
  // mkdir recursive: data/ 不存在时建，data/ 已存在时也不报错
  await mkdir(DATA_DIR, { recursive: true });

  // ---------- 2. 连接 Milvus ----------
  // connectPromise 是 SDK 内部自动发起的握手；await 它 = "确保连接成功后继续"
  console.log("\n连接 Zilliz Cloud Serverless...");
  try {
    await client.connectPromise;
    console.log("✓ 已连接\n");
  } catch (error) {
    console.error("✗ 连接失败:", error.message);
    console.error("  请检查 MILVUS_ADDRESS / MILVUS_TOKEN 是否正确（控制台 → 集群详情）");
    process.exit(1);
  }

  // ---------- 3. 业务参数 ----------
  // 当前示例固定为 1；多本书场景下可改成从命令行参数 / 环境变量传入
  const bookId = 1;

  // ---------- 4. 确保集合 + 索引就绪 ----------
  await ensureCollection(bookId);

  // ---------- 5. 流式加载 + 灌库 + 落盘 ----------
  // 这一步是大头：把 EPUB 按章节拆开 → 二次切 chunk → Embedding → 插入 Milvus → 写 .jsonl
  const { total, failedChapters } = await loadAndProcessEPubStreaming(bookId);

  // ---------- 6. 汇总 ----------
  console.log("=".repeat(80));
  console.log("处理完成！");
  console.log(`  成功写入: ${total} 条`);
  console.log(`  落盘文件: ${JSONL_FILE}`);
  if (failedChapters.length) {
    console.log(`  ⚠ 失败章节: ${failedChapters.join(", ")}`);
    console.log(`    可重跑脚本（按 bookId_chapterNum_index 主键幂等覆盖）`);
  } else {
    console.log("  ✓ 全部章节成功");
  }
  console.log("=".repeat(80));

  // 有失败章节 → 退出码 1，让 CI/Shell 能感知
  if (failedChapters.length) {
    process.exit(1);
  }
}

main();
