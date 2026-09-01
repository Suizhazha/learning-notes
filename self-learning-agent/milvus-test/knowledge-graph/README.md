# milvus-test 知识图谱

存放本项目学习过程中沉淀的**Milvus 知识图谱**。当前锚点章节是 `src/insert.mjs`（建表 / 索引 / 灌库）+ `src/query.mjs`（向量检索）+ `src/rag.mjs`（RAG 检索增强生成闭环），整套图谱覆盖 Milvus 完整 CRUD（C/R/U/D）+ 集合管理 + 索引 + 检索 + RAG 闭环 + 系统管理。

> ⚠️ **文件名与语义对齐提示**：`src/query.mjs` 文件名是中文语境里的“查日记”，但它演示的其实是 `client.search`（向量检索 / ANN），不是 `client.query`（标量过滤查询）。知识图谱中 `step.search` 才是本文件对应的节点。

## 文件清单

| 文件 | 角色 | 维护方式 |
|------|------|----------|
| `graph.json` | **单一事实源**，机器可读；定义节点 + 边 | 手编 |
| `graph.md` | Mermaid 渲染图谱 + 节点说明表，IDE 直接预览 | 手编，与 JSON 严格对齐 |
| `README.md` | 本文件，使用与维护说明 | — |

## 设计原则

- **JSON 是唯一事实源**：所有节点和边先在这里改，再同步到 `graph.md`
- **手动维护**：当前阶段每次新增 `.mjs` 时手动改 JSON；后续如频繁扩展可加 `scripts/regen-graph.mjs` 自动扫描
- **节点命名约定**：
  - `step.<动词>_<宾语>`：操作步骤，如 `step.create_collection`
  - `concept.<名词>`：抽象概念，如 `concept.collection`
  - `param.<名字>`：关键参数 / 配置项，如 `param.vector_dim`
- **边关系**：
  - `前置`：流程上必须先做 A 才能做 B
  - `后置`：A 之后通常会做 B
  - `依赖`：A 在概念 / 参数上依赖 B
  - `对照`：A 与 B 是相似 / 互为反义的概念
  - `无依赖`：可独立并行（用虚线在 Mermaid 中表现）

## 节点字段说明

```json
{
  "id": "step.create_collection",     // 全局唯一 ID，必须与命名约定一致
  "label": "创建集合",                // 人类可读的中文短名
  "category": "step",                 // step | concept | param
  "summary": "…",                     // 1-2 句话简短说明
  "impl_file": "src/insert.mjs",      // 在哪个 .mjs 里实现；未实现则为 null
  "impl_lines": "63-75",              // 在文件中的行号范围
  "api": "client.createCollection(…)" // 对应 SDK 调用示例
}
```

## 边字段说明

```json
{
  "from": "step.connect",             // 起点节点 ID
  "to": "step.create_collection",     // 终点节点 ID
  "relation": "前置",                 // 前置 | 后置 | 依赖 | 对照 | 无依赖
  "note": "必须先连接才能建集合"      // 一句话解释
}
```

## 更新流程（添加新 .mjs 后）

以新增 `src/search.mjs` 为例，它演示 `client.search`。

1. **找到节点**：在 `graph.json` 中找到 `step.search`
2. **回填代码位置**：
   ```json
   {
     "id": "step.search",
     "impl_file": "src/search.mjs",
     "impl_lines": "30-55",
     ...
   }
   ```
3. **新增边（如果引入新的依赖关系）**：例如 search 用到了 query，可在 JSON `edges` 数组追加：
   ```json
   { "from": "step.search", "to": "step.query", "relation": "对照", "note": "..." }
   ```
4. **同步 `graph.md`**：
   - 在"节点说明表"里更新该行的 `代码位置` 列
   - 如果新增了边，把它加入"边（关系）一览"表
   - 如有结构性变化（新增 subgraph / 类图新增类），同步更新 Mermaid 块
5. **校验 JSON 合法**：
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('graph.json','utf8'))" && echo OK
   ```
   或运行完整校验：
   ```bash
   cat > /tmp/check-graph.cjs <<'EOF'
   const fs = require('node:fs');
   const g = JSON.parse(fs.readFileSync('graph.json','utf8'));
   const ids = new Set(g.nodes.map(n => n.id));
   const bad = g.edges.filter(e => !ids.has(e.from) || !ids.has(e.to));
   console.log('节点:', g.nodes.length, ' 边:', g.edges.length, ' 断边:', bad.length);
   EOF
   node /tmp/check-graph.cjs
   ```

## 添加全新操作（如 `src/delete.mjs`）

如果 `.mjs` 引入了一个 `graph.json` 里**还没有**的步骤（例如 `step.compact` 压缩 segment），按以下步骤扩展：

1. 在 `graph.json` 的 `nodes` 数组追加新节点，遵循命名约定
2. 在 `edges` 数组追加它与上下游的边（至少一条 `前置` 边 + 一条与已存在概念的对照/依赖）
3. 在 `graph.md` 的 Mermaid `flowchart` 里：
   - 把新节点放进对应 subgraph
   - 用 `classDef` 已定义的样式（已有 `step`/`concept`/`param` 三类）
   - 把新边用 `A -->|relation| B` 加进去
4. 在 `graph.md` 的"节点说明表"和"边一览"中同步

## 当前覆盖范围（截至本次更新）

- **已落地的代码脚本**：
  - `src/insert.mjs`：connect / createCollection / createIndex / loadCollection / insert
  - `src/query.mjs`：client.search（向量检索 / ANN）
  - `src/rag.mjs`：完整 retrieve → augment → generate 闭环
- **C（Create）**: connect / create_collection / create_index / load_collection / insert / upsert
- **R（Read）**: query / search / hybrid_search / get
- **U（Update）**: upsert / alter_collection（暂未单列，归到 upsert 旁注）
- **D（Delete）**: delete / release_collection / drop_collection
- **辅助**: flush / create_partition / create_alias
- **RAG 闭环**: retrieve / augment / generate
- **概念**: Collection / Field / Schema / PrimaryKey / Index / MetricType / Embedding / Partition / Alias / RAG / Prompt / Context / LLM
- **参数**: VECTOR_DIM / IVF_FLAT.nlist

如需扩到更多内容（例如用户管理 / 角色 RBAC / 多副本 / 跨集群同步、向量召回评估、流式回答 / 多轮对话 / Agent 工具调用），按上述流程补充节点即可。