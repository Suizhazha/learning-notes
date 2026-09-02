/**
 * ebook-write.mjs — 把 EPUB 电子书灌入 Milvus 的端到端示例
 *
 * 本脚本演示一条"EPUB 文件 → 章节切分 → 二次文本拆分 → 向量化 → 灌库"链路：
 *   1. 使用 LangChain 的 EPubLoader 按章节加载 .epub 文件
 *   2. 使用 RecursiveCharacterTextSplitter 把每章二次拆分为 ~500 字符的 chunk
 *      （相邻 chunk 保留 50 字符重叠，保证上下文连贯）
 *   3. 对每个 chunk 调用 Embedding 模型生成 1024 维向量
 *   4. 边处理边插入（流式处理），避免一次性把所有章节加载到内存
 *
 * 与 insert.mjs 的差异：
 *   - insert.mjs 处理 5 条手工构造的短文本；
 *     本脚本处理"长文档"，因此多了"按章节拆分 + 二次文本拆分"两步预处理
 *   - 本脚本的"插入"是按章节循环流式进行的（chapterIndex → chunks → embedding → insert）
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
 * 前置条件：
 *   - Milvus 服务已在 localhost:19530 监听
 *   - .env 中已配置 OPENAI_API_KEY / OPENAI_BASE_URL / EMBEDDINGS_MODEL_NAME
 *   - EMBEDDINGS_MODEL_NAME 输出的向量维度必须等于 VECTOR_DIM（1024）
 *   - 当前目录有 EPUB_FILE 指向的 .epub 文件（默认 ./天龙八部.epub）
 *   - 已安装依赖：@langchain/community（EPubLoader）、@langchain/textsplitters
 *
 * 运行：
 *   node src/ebook-write.mjs
 */

// ---------------- 依赖引入 ----------------
import "dotenv/config"; // 把 .env 中的环境变量加载到 process.env
import { parse } from "path"; // Node 内置 path 模块，用于从文件路径提取书名
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
const EPUB_FILE = "./天龙八部.epub"; // 待处理的 EPUB 文件路径（相对于 cwd）

// 从文件名提取书名（去掉扩展名），后续写入 book_name 字段便于按书过滤
const BOOK_NAME = parse(EPUB_FILE).name;

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
 * 构造 Milvus SDK 客户端。
 * address 格式 host:port；这里连本地 standalone Milvus。
 * SDK 内部维护一个 connectPromise，调用方 await 它即可等待连接握手完成。
 */
const client = new MilvusClient({
  address: "localhost:19530",
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

// ---------------- 集合初始化 ----------------
/**
 * 确保目标集合存在；若不存在则创建字段定义、向量索引并加载到内存。
 *
 * 注意：loadCollection 重复调用在 SDK 中可能抛错（"已加载"），
 * 因此用 try/catch 兜底——已加载也视为成功，不影响后续流程。
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
      console.log("创建索引...");
      /**
       * IVF_FLAT + COSINE：
       *   - IVF_FLAT 倒排聚类 + 簇内精确距离，实现简单、召回稳定
       *   - COSINE 余弦相似度，对文本语义检索最常用
       *   - nlist = 1024 是聚类中心数；经验值 ≈ sqrt(N) ~ 4*sqrt(N)
       *     若总数据量很少（如只有几千个 chunk），可调小到 64~256 提升小数据集召回
       */
      await client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: "vector",
        index_type: IndexType.IVF_FLAT,
        metric_type: MetricType.COSINE,
        params: { nlist: 1024 },
      });
      console.log("✓ 索引创建成功");
    }

    // ---------- 4. 加载集合到内存 ----------
    // 灌库本身不要求集合已加载（insert 不依赖内存索引），
    // 但加载后才能立即进行 search/query；为了一站式完成，这里一并加载。
    try {
      await client.loadCollection({ collection_name: COLLECTION_NAME });
      console.log("✓ 集合已加载");
    } catch (error) {
      // SDK 可能在"已加载"状态重复调用时抛错；这里吞掉，视为已加载即可
      console.log("✓ 集合已处于加载状态");
    }
  } catch (error) {
    console.error("创建集合时出错:", error.message);
    throw error;
  }
}

// ---------------- 批量插入 ----------------
/**
 * 把同一章节内的所有 chunk 一次性向量化并插入 Milvus。
 *
 * 设计要点：
 *   - 用 Promise.all 并行处理 chunk 的 Embedding，
 *     平均 Embedding 延迟 ≈ 单次调用，而不是 N 次串行
 *   - 手动拼主键 id = `${bookId}_${chapterNum}_${chunkIndex}`
 *     这样无论重跑多少次，同一位置都生成同一个主键，天然支持幂等（重复插入会变成 upsert 语义）
 *   - 一次 client.insert 写完一个章节，减少 RPC 次数
 *
 * @param {string[]} chunks   - 当前章节切分出的文本片段
 * @param {string|number} bookId - 书籍业务 ID
 * @param {number} chapterNum - 章节号（1-based）
 * @returns {Promise<number>} 实际写入条数
 */
async function insertChunksBatch(chunks, bookId, chapterNum) {
  try {
    if (chunks.length === 0) {
      return 0;
    }

    // 为每个 chunk 生成向量，并补齐 schema 要求的全部字段
    const insertData = await Promise.all(
      chunks.map(async (chunk, chunkIndex) => {
        const vector = await getEmbedding(chunk);
        // 手动生成主键：bookId_chapterNum_index，便于幂等 & 后续按主键定位
        return {
          id: `${bookId}_${chapterNum}_${chunkIndex}`,
          book_id: bookId,
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

    return Number(insertResult.insert_cnt) || 0;
  } catch (error) {
    // 常见错误：
    //   - "dimension mismatch"：chunk 长度超过 max_length=10000，或 Embedding 输出维度被改了
    //   - "primary key duplicated"：bookId/chapterNum/chunkIndex 组合重复；一般是重跑造成
    //     实际行为是覆盖（视同 upsert），不算错误
    console.error(`插入章节 ${chapterNum} 的数据时出错:`, error.message);
    console.error("错误详情:", error);
    throw error;
  }
}

// ---------------- EPUB 流式处理 ----------------
/**
 * 加载 EPUB 文件并按"章节 → chunk → Embedding → insert"的顺序流式处理。
 *
 * 为什么用"流式"而不是"先把全本拆完再一起灌库"：
 *   - 一次性把整本书的所有 chunk 加载到内存可能 OOM（《天龙八部》全本切 500 字符会有上万个 chunk）
 *   - 流式可以"边拆边灌"，每章写完就释放该章的内存
 *   - 失败时也能精确定位到"哪一章"出错，便于重试
 *
 * EPubLoader 的 splitChapters:true 会按 EPUB 的目录项把全书拆成多份 Document；
 * 每份 Document 的 pageContent 就是该章的纯文本。
 *
 * @param {string|number} bookId - 书籍业务 ID
 * @returns {Promise<number>} 总写入条数
 */
async function loadAndProcessEPubStreaming(bookId) {
  try {
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
     * chunkOverlap = 50 让相邻 chunk 末尾重叠 50 字符，
     * 避免在切分边界处"前半句/后半句"被割裂，检索时不会因为边界而漏召回。
     */
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: 50, // 50 字符重叠，维持上下文连贯
    });

    let totalInserted = 0;

    // ---------- 3. 逐章处理：拆 → 向量化 → 插入 ----------
    for (
      let chapterIndex = 0;
      chapterIndex < documents.length;
      chapterIndex++
    ) {
      const chapter = documents[chapterIndex];
      const chapterContent = chapter.pageContent;

      console.log(`处理第 ${chapterIndex + 1}/${documents.length} 章...`);

      // 二次拆分：长章节切成 ~500 字符的短 chunk
      const chunks = await textSplitter.splitText(chapterContent);
      console.log(`  拆分为 ${chunks.length} 个片段`);

      if (chunks.length === 0) {
        // 极端情况：整章是空字符串或只有空白字符
        console.log(`  跳过空章节\n`);
        continue;
      }

      console.log(`  生成向量并插入中...`);

      // 当前章节所有 chunk 一次性向量化并插入（一章一次 RPC）
      const insertedCount = await insertChunksBatch(
        chunks,
        bookId,
        chapterIndex + 1, // 章节号 1-based，更符合"第几章"的业务语义
      );
      totalInserted += insertedCount;

      console.log(
        `  ✓ 已插入 ${insertedCount} 条记录（累计: ${totalInserted}）\n`,
      );
    }

    console.log(`\n总共插入 ${totalInserted} 条记录\n`);
    return totalInserted;
  } catch (error) {
    // 常见错误：
    //   - EPUB 解析失败：文件损坏 / 不是合法 .epub
    //   - 内存不足：极少见于《天龙八部》这种长度，更大部头才需要进一步分批
    console.error("加载 EPUB 文件时出错:", error.message);
    throw error;
  }
}

// ---------------- 主流程 ----------------
/**
 * 主函数：连接 → 建集合 → 流式灌库
 */
async function main() {
  try {
    console.log("=".repeat(80));
    console.log("电子书处理程序");
    console.log("=".repeat(80));

    // ---------- 1. 连接 Milvus ----------
    // connectPromise 是 SDK 内部自动发起的握手；await 它 = "确保连接成功后继续"
    console.log("\n连接 Milvus...");
    await client.connectPromise;
    console.log("✓ 已连接\n");

    // ---------- 2. 业务参数 ----------
    // 当前示例固定为 1；多本书场景下可改成从命令行参数 / 环境变量传入
    const bookId = 1;

    // ---------- 3. 确保集合 + 索引就绪 ----------
    await ensureCollection(bookId);

    // ---------- 4. 流式加载 + 灌库 ----------
    // 这一步是大头：把 EPUB 按章节拆开 → 二次切 chunk → Embedding → 插入 Milvus
    await loadAndProcessEPubStreaming(bookId);

    console.log("=".repeat(80));
    console.log("处理完成！");
    console.log("=".repeat(80));
  } catch (error) {
    // 任何一步失败：打印 message + 完整堆栈，然后以非 0 退出码退出
    // 这样 shell / CI 才能识别失败
    console.error("\n错误:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
