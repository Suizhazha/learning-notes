# milvus-test 快速复习

> 覆盖范围：CRUD 五件套（insert / query / rag / update / delete）+ 电子书实战 6 个脚本（write / query / render-rag 各 localhost & remote 两版）。
> 前置关联：rag-test（MemoryVectorStore 内存版 + 切分器）→ 本目录（生产级向量库）；memory-test 的 retrieval-memory 也用了 Milvus。
> 知识图谱：`knowledge-graph/graph.json`（55 节点 / 79 边）。

---

## 1. 一图流：Milvus 的心智模型

```
Milvus ≈ "会做向量检索的表"
  Collection ≈ Table         fields ≈ 列（含 1 个 FloatVector 向量列）
  insert/upsert/delete ≈ 增改删    search ≈ 向量 ANN    query ≈ 标量过滤
                 ↓ 关键差异
传统库：行 → 索引 → 精确匹配
Milvus：文本 → Embedding → 向量列；问题 → Embedding → ANN 找 TopK 最近邻
```

**一句话总结**：三步上线——`createCollection`（定义含 FloatVector 的 schema）→ `createIndex`（IVF_FLAT/AUTOINDEX + metric）→ `loadCollection`（进内存才能 search）；之后 insert 灌库、search 检索、upsert 更新、delete 软删。

---

## 2. 核心速查表

| 概念 | 说明 |
|------|------|
| `MilvusClient({ address })` | 19530 = standalone 默认 gRPC 端口；`await client.connectPromise` 等握手 |
| `DataType.VarChar / FloatVector / Int32 / Array` | Array 要带 `element_type + max_capacity + max_length` |
| `is_primary_key: true` | 主键业务侧自生成（无 auto-id 时必填） |
| `IndexType.IVF_FLAT` | 倒排+精确距离，中小规模；`params: { nlist: 1024 }`（经验值 √N~4√N） |
| `IndexType.AUTOINDEX` | **Zilliz Cloud Serverless 只支持这个**，params 留空，云端自动选算法 |
| `MetricType.COSINE` | 余弦；**score 是相似度，越大越像**（L2 才是越小越像） |
| `client.search` | 向量检索：`{ collection_name, vector, limit, metric_type, output_fields }` → `.results[{id, score, ...}]` |
| `client.query` | 标量过滤（filter 表达式），**不是向量检索** |
| `client.upsert` | 更新的唯一姿势：主键存在→整行覆盖；不存在→变 insert |
| `client.delete({ filter })` | 软删除：立即不可见但占磁盘，flush+compaction 才回收 |
| `loadCollection` | QueryNode 进内存；**search 前必须 load**（Serverless 免） |
| `filter 表达式` | `id == "x"`（字符串带双引号）/ `in [...]` / `&& \|\| !` / `like "str%"` / `json["key"]` |
| `EPubLoader(path, { splitChapters: true })` | 按目录项一章一 Document；`@langchain/community` |
| `output_fields` | 标量白名单；向量本身不返回（省带宽） |

**VECTOR_DIM=1024 三处对齐铁律**：① schema 的 `FloatVector.dim` ② `OpenAIEmbeddings({ dimensions })` ③ Embedding 模型实际输出。任一不一致 → dimension mismatch。

---

## 3. 必背流程

### 3.1 建库灌库（insert.mjs）—— 7 步
```js
await client.connectPromise;                                  // ① 握手
await client.createCollection({ collection_name, fields });  // ② 建表
await client.createIndex({ field_name: 'vector', index_type, metric_type, params }); // ③ 索引
await client.loadCollection({ collection_name });             // ④ 进内存
const data = await Promise.all(rows.map(async r => ({ ...r, vector: await getEmbedding(r.content) }))); // ⑤ 并行向量化
await client.insert({ collection_name, data });               // ⑥ 写入（insert_cnt 计数）
// ⑦ ai_diary schema：id(PK) + vector + content + date + mood + tags(Array)
```

### 3.2 向量检索（query.mjs）
```js
const queryVector = await getEmbedding("我做饭或学习的日记");
const searchResult = await client.search({
  collection_name, vector: queryVector, limit: 2,
  metric_type: MetricType.COSINE,            // ★ 必须与建索引时一致
  output_fields: ['id', 'content', 'date', 'mood', 'tags'],
});                                          // → searchResult.results
```
⚠️ **文件名陷阱**：query.mjs 演示的是 `client.search`（向量检索），不是 `client.query`（标量查询）。

### 3.3 RAG 闭环（rag.mjs）—— 检索 + 增强两手抓
```js
// 检索层 catch 后返回 []（降级到无上下文回答），不向上抛
const diaries = await retrieveRelevantDiaries(question, k); // 空→兜底文案，不让 LLM 编
// Augment：每条带编号+字段标签+━━━分隔，让 LLM 看清边界
const context = diaries.map((d,i)=>`[日记 ${i+1}]\n日期: ${d.date}\n...内容: ${d.content}`).join('\n\n━━━━━\n\n');
// Prompt 5 要素：角色设定 / context 显式给 / 任务约束（基于日记、可跨篇总结、无信息明说）/ 风格（第二人称"你"）/ 同理心
const response = await model.invoke(prompt);
```

### 3.4 更新 = upsert（update.mjs）
```js
const vector = await getEmbedding(newContent);  // ★ 必须重新 Embedding
await client.upsert({ collection_name, data: [{ ...newContent, vector }] });
```
不重新向量化 → 文本新、向量旧 → 检索按旧语义召回，隐性 bug。

### 3.5 删除三姿势（delete.mjs）
```js
client.delete({ filter: `id == "${id}"` });            // 单条
client.delete({ filter: `id in ["a", "b"]` });         // 批量
client.delete({ filter: `mood == "sad"` });            // 条件（危险！生产加时间/标签限定）
// 后续：flush 落盘 + compaction 才真正回收磁盘
```

### 3.6 长文档流水线（ebook-write-remote.mjs）
```
EPUB → EPubLoader(splitChapters) → 逐章循环：
  splitText(chunkSize=500, chunkOverlap=50)           // 二次拆分
  → Promise.all 逐 chunk embed                         // 同章并行
  → insert（主键 `${bookId}_${chapterNum}_${chunkIndex}`）// 幂等：重跑=覆盖
  → appendJsonl 落盘                                   // Milvus 成功才写，jsonl=审计索引
  单章失败不中断，记 failedChapters，最后 exit(1) 让 CI 感知
```
主键设计是精髓：**确定性主键 → 天然幂等**，失败重跑即断点续传。

---

## 4. 横向对比表

### localhost（standalone）vs remote（Zilliz Cloud Serverless）★ 本目录最重要的对比

| 维度 | -localhost.mjs | -remote.mjs |
|------|---------------|-------------|
| 连接 | `address: 'localhost:19530'` | `address: MILVUS_ADDRESS` + `token: MILVUS_TOKEN` + `database` |
| 鉴权 | 无 | ApiKey token（控制台集群详情获取） |
| 索引 | `IVF_FLAT + params.nlist` | **只能 `AUTOINDEX`，params 留空** |
| loadCollection | 必须显式调（query/render 里还包了 "already loaded" 容错） | **不需要**（Serverless 按需拉取，无 QueryNode 概念） |
| 示例书 | 天龙八部 | 三国演义 |
| 凭证 | 部分硬编码 | 全走 .env + 启动时 `validateEnv()` 缺失即退出 |
| 额外产物 | — | `data/<书名>__chunks.jsonl` 审计落盘（vector 不写只记 dim） |

### Milvus CRUD API 对照 SQL 心智

| SQL | Milvus SDK | 注意 |
|-----|-----------|------|
| CREATE TABLE | createCollection | fields 定义 schema |
| CREATE INDEX | createIndex | 索引类型+metric+nlist |
| INSERT | insert | data 必须含全字段（除 auto-id） |
| UPDATE | **无原生 update** → upsert | 整行覆盖+必须重新 Embedding |
| DELETE WHERE | delete({ filter }) | 软删除 |
| 向量 TopK 查询 | **search** | query 是标量过滤，别混 |
| SELECT WHERE | query({ filter }) | 也要先 load |

### search vs query（易混！）

| | `client.search` | `client.query` |
|---|---|---|
| 输入 | 查询**向量** | filter **表达式** |
| 目标 | 语义相似 TopK | 字段精确过滤 |
| 返回 | `.results`（含 score） | `.data` |

### 同仓库三处 Milvus 用法对照

| | memory-test/retrieval | milvus-test ai_diary | milvus-test ebook |
|---|---|---|---|
| 数据 | 对话文本（运行时） | 5 条日记（手工） | 整本小说（流式） |
| 主键 | `conv_${Date.now()}_${i}`（时间戳，非幂等） | `diary_001` | `${bookId}_${chapter}_${chunk}`（**幂等**） |
| 规模应对 | 一次性 insert | 一次性 insert | 逐章 insert + jsonl 审计 + 失败章列表 |

---

## 5. 踩坑速查表

| # | 坑 | 正解 |
|---|----|------|
| 1 | **dimension mismatch** | dim 三处对齐（schema / embeddings.dimensions / 模型输出）；qwen text-embedding-v3 显式传 `dimensions: 1024` |
| 2 | **collection not loaded** | search 前必 `loadCollection`；Milvus 重启后要重新 load（可包 "already loaded" try-catch 容错） |
| 3 | **metric type mismatch** | search 的 metric_type 必须与 createIndex 时完全一致 |
| 4 | score 读反 | COSINE 下 score 是**相似度越大越像**（0~1）；MemoryVectorStore 是距离越小越像——两库方向相反！ |
| 5 | upsert 忘重新 Embedding | 新文本必须新生成向量，否则文本/向量失配 |
| 6 | upsert 缺字段 | 整行覆盖，缺的字段变默认值；严格更新前先 get 确认行存在 |
| 7 | filter 字符串漏双引号 | `id == "diary_005"` 字符串必须双引号，数值不用；语法错报 "filter parse error" |
| 8 | 条件删除裸奔 | `mood == "sad"` 全表扫删；生产加时间段/标签组合限定 |
| 9 | 软删除当真删了 | delete 只写 delete log，flush + compaction 后才释放磁盘 |
| 10 | Serverless 传 IVF_FLAT | Serverless 只认 AUTOINDEX；反过来 Dedicated 集群要自己选索引+params |
| 11 | Serverless 还调 loadCollection | 不需要；已加载容错写法在 standalone 才有意义 |
| 12 | 整本书一次性进内存 | OOM 风险；用逐章流式（ebook-write-remote 的核心设计） |
| 13 | search 参数名 | 本 SDK 版本用 `vector`（单数）；新版官方 SDK 已改 `data: [vec]`（数组） |
| 14 | 集合已存在还 createCollection | 先 `hasCollection` 再建（ensureCollection 模式） |
| 15 | tags 可能为空 | Array 字段用可选链 `item.tags?.join(', ')` 防御 |

---

## 6. 运行速查

```bash
cd milvus-test
pnpm install

# .env 需要：OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME / EMBEDDINGS_MODEL_NAME
# remote 系列额外需要：MILVUS_ADDRESS / MILVUS_TOKEN / MILVUS_DB_NAME（默认 default）

# --- localhost 系列：前置 = 本地 Milvus（docker / standalone，:19530）---
node src/insert.mjs                       # 建 ai_diary + 灌 5 条日记（CRUD 系列的地基）
node src/query.mjs                         # 向量检索 Top2
node src/rag.mjs                          # 日记 RAG 问答
node src/update.mjs                       # upsert 更新 diary_001
node src/delete.mjs                        # ⚠️ 会删数据，跑前想清楚（删 005/002/003 + 所有 sad）
node src/ebook-write-localhost.mjs         # 需 ./天龙八部.epub
node src/ebook-query-localhost.mjs
node src/ebook-render-rag-localhost.mjs

# --- remote 系列：前置 = Zilliz Cloud Serverless 集群 ---
node src/ebook-write-remote.mjs            # 灌三国演义 → data/*__chunks.jsonl
node src/ebook-query-remote.mjs
node src/ebook-render-rag-remote.mjs

pnpm graph:sync                            # 知识图谱锚点 diff
```
依赖：`@zilliz/milvus2-sdk-node@^3` + `@langchain/openai` + `@langchain/community`（EPubLoader）+ `@langchain/textsplitters` + `epub2`。

---

## 7. 延伸知识点（联想区）

1. **HNSW / DISKANN / SCANN**：IVF_FLAT 是入门索引；HNSW（图索引，高召回高内存）、DISKANN（磁盘级，超大规模）是另两大家族；AUTOINDEX 就是云端替你做这个选型
2. **nlist/nprobe 权衡**：nlist 是建库时的聚类中心数（影响构建），nprobe 是查询时探查的桶数（影响召回 vs 延迟）——本目录只传了 nlist，检索调优要补 nprobe
3. **Partition 分区**：按 book_id / 时间建分区，检索带 `partitions: [...]` 直接跳过无关数据，比 filter 全扫高效；delete 注释里提过"删整分区更高效"
4. **hybridSearch**：多向量场（dense+sparse）+ rerank 的混合检索（SDK 里和 search/query 并列的第三个检索入口），正好接 rag-test 延伸区的 Hybrid Search 方向
5. **Milvus 的 LangChain 集成**：手写 SDK（本目录）→ `Milvus.fromDocuments` / `Milvus.asRetriever`（rag-test 的 MemoryVectorStore 同款接口）；切换成本为零
6. **全文检索 BM25（2.5+ 新能力）**：Milvus 已内置 sparse 向量 + BM25，"建库时就同时存稠密+稀疏"，不需要外挂 ES
7. **flush / consistency level**：insert 后数据不立即可搜，flush 强制落盘；Strong/Bounded/Stale/Eventually 四级一致性——"写完立刻搜不到"的根源
8. **确定性主键的幂等设计**：`${bookId}_${chapter}_${chunk}` 模式可推广到一切"ETL 重跑"场景（对照 rag-test 网页抓取：URL+chunkHash 做主键即可增量更新不重复）
9. **Zilliz Cloud Serverless 计费心智**：按存储+计算请求计费、无 QueryNode 概念；对应改造清单（token 鉴权/AUTOINDEX/去 load）就是"托管版 vs 自托管"的通用差异模板
10. **多向量/母子分块（parent-child chunking）**：500 字符 chunk 检索、命中后返回整章上下文——解决"chunk 太短没上下文、太长稀释向量"的经典矛盾

---

## 8. 自测清单（合上文档回答）

1. Milvus 建库三步？（createCollection → createIndex → loadCollection；Serverless 免第三步）
2. VECTOR_DIM 必须在哪三处对齐？（schema.dim / embeddings.dimensions / 模型实际输出）
3. `client.search` 的 5 个关键参数？（collection_name / vector / limit / metric_type / output_fields）
4. search 和 query 的本质区别？（向量 ANN vs 标量 filter 过滤；返回 .results vs .data）
5. Milvus 怎么"更新"一行？两个必须注意的点？（upsert；沿用原 id + 重新 Embedding）
6. COSINE 下 score 越大越好还是越小越好？MemoryVectorStore 呢？（越大越好；Memory 是距离越小越好）
7. delete 是立即释放磁盘吗？（否，软删除，flush+compaction 才回收）
8. localhost 版和 remote 版的 5 个差异？（连接鉴权 token / AUTOINDEX vs IVF_FLAT / 免 loadCollection / 全 .env / jsonl 落盘）
9. ebook-write-remote 为什么逐章流式而不是整本？主键怎么设计、带来什么性质？（防 OOM+定位失败章；bookId_chapter_chunk；幂等可重跑）
10. filter 表达式删除 mood=="sad" 有什么风险？（全表批量误删；生产加限定条件）
11. rag.mjs 检索失败时为什么不往上抛异常？（返回 [] 降级到无上下文回答，RAG 容错策略）
12. jsonl 落盘为什么等 Milvus 插入成功后才写？vector 为什么不写进去？（保证 jsonl=已入库可靠索引；1024 浮点写进去文件爆炸，只记 dim）
