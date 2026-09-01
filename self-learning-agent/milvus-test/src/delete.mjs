// ---------------------------------------------------------------------------
// delete.mjs —— Milvus 删除数据示例（按主键 / 批量 / 条件三种姿势）
// ---------------------------------------------------------------------------
// 【Milvus 删除的特点】
//   1) 删除是**软删除**：写入 delete log 标记，不会立即回收磁盘。
//   2) search/query 立即看不到，但底层 segment 合并（compaction）前仍占空间。
//   3) 想要释放磁盘，需要再调 flush + 等待 segment 合并完成。
//   4) 删除语法是统一的 "filter 表达式"，不是 "where id in (...)" 这种
//      SQL 风格的参数——这一点和 query/search 一致。
// ---------------------------------------------------------------------------

// 加载 .env（本脚本不依赖，但保持项目内脚本一致）
import "dotenv/config";
// Milvus SDK（删除只需 MilvusClient，不需要 MetricType）
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const COLLECTION_NAME = 'ai_diary';

// ---------------------------------------------------------------------------
// Milvus 客户端
// ---------------------------------------------------------------------------
const client = new MilvusClient({
  address: 'localhost:19530'
});

// ---------------------------------------------------------------------------
// 主流程：连接 → 单条删除 → 批量删除 → 条件删除
// ---------------------------------------------------------------------------
async function main() {
  try {
    // 1) 等待 SDK 内部握手完成
    console.log('Connecting to Milvus...');
    await client.connectPromise;
    console.log('✓ Connected\n');

    // ---------- 姿势 1：按主键删除单条 ----------
    //
    // filter 用 Milvus 表达式语法：
    //   - 字符串字段：`id == "diary_005"`（必须双引号）
    //   - 数值字段：`id == 5`（无双引号）
    //   - 布尔字段：`is_active == true`
    console.log('Deleting diary entry...');
    const deleteId = 'diary_005';

    const result = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `id == "${deleteId}"`
      // 也可以用 `ids: [deleteId]` 直接传主键数组（部分 SDK 版本支持），
      // 但 filter 写法更通用、对所有版本都适用。
    });

    // result.delete_cnt 是软删除生效的条数（不代表立即从磁盘释放）
    console.log(`✓ Deleted ${result.delete_cnt} record(s)`);
    console.log(`  ID: ${deleteId}\n`);

    // ---------- 姿势 2：批量删除（多 id 用 `in` 表达式） ----------
    //
    // `in [...]` 接受一个列表，注意：
    //   - 列表里的字符串也要带双引号
    //   - 元素之间是逗号+空格（和 SQL 不同，Milvus 容忍，但建议加空格）
    console.log('Batch deleting diary entries...');
    const deleteIds = ['diary_002', 'diary_003'];
    const idsStr = deleteIds.map(id => `"${id}"`).join(', ');

    const batchResult = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `id in [${idsStr}]`
    });

    console.log(`✓ Batch deleted ${batchResult.delete_cnt} record(s)`);
    console.log(`  IDs: ${deleteIds.join(', ')}\n`);

    // ---------- 姿势 3：按字段条件删除 ----------
    //
    // Milvus filter 表达式支持的运算符 / 函数（节选）：
    //   - 比较：==  !=  >  <  >=  <=
//   - 逻辑：&&  ||  !
    //   - 范围：in [...]  like "str%"（VarChar）
    //   - 算术：+  -  *  /  %
    //   - JSON 字段：json["key"] == value
    //
    // 注意：`mood == "sad"` 会把当前所有 mood=sad 的行删掉，
    // 生产环境强烈建议带更严格的限定（如时间段、标签组合），
    // 否则一旦手滑就是批量误删。
    console.log('Deleting by condition...');
    const conditionResult = await client.delete({
      collection_name: COLLECTION_NAME,
      filter: `mood == "sad"`
    });

    console.log(`✓ Deleted ${conditionResult.delete_cnt} record(s) with mood="sad"\n`);

    // ---------- 重要：删除后常见后续操作 ----------
    // 1) flush —— 让删除日志落盘，并参与 segment 合并（异步，需要等）
    //    await client.flush({ collection_names: [COLLECTION_NAME] });
    //
    // 2) 验证 —— 用 query 或 get 看看指定 id 是否还在
    //    const check = await client.query({
    //      collection_name: COLLECTION_NAME,
    //      filter: `id == "${deleteId}"`,
    //      output_fields: ['id']
    //    });
    //    console.log('still exists?', check.data.length > 0);
    //
    // 3) 大量删除建议配合 partition：
    //    如果按时间分区，先删整分区比按条件逐行删更高效。

  } catch (error) {
    // 常见错误：
    //   - "filter parse error"：表达式语法错（漏双引号、符号错位）
    //   - "collection not loaded"：本示例 delete 不需要加载，
    //     但如果用 query 校验就得先 loadCollection
    //   - "primary key not found"：id 写错或字段名大小写不匹配 schema
    console.error('Error:', error.message);
  }
}

main();