#!/usr/bin/env node
/**
 * scripts/sync-graph.mjs
 * -----------------------------------------------------------------------------
 * 知识图谱自动同步工具
 *
 * 用法（在子项目根目录执行）：
 *   pnpm graph:sync    # 只打 diff，不写盘
 *   pnpm graph:apply   # 写盘 + 备份 graph.json.bak
 *
 * 也支持直接调用：
 *   node ../scripts/sync-graph.mjs --project=<name> [--apply]
 *
 * 设计要点：
 *   - 节点定位：扫描 src/*.mjs 里的 `// @graph: <id>` 单行注释（JSDoc 风格锚点）
 *   - 行号回填：从锚点行向下扫描到下一个锚点或文件末尾，得到 impl_lines
 *   - 保守写入：只回填 impl_file/impl_lines，不动 label/summary/api/边
 *   - diff 分类：绿=回填、黄=候选新增、红=可能已删除、灰=提示
 *
 * 失败兜底：
 *   - --apply 前自动备份 graph.json.bak
 *   - 写盘后用 JSON.parse 校验合法性，失败自动回滚
 *   - 锚点 ID 命名违规（非 step./concept./param.）会报错跳过
 * -----------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// =============================================================================
// 常量 & 颜色
// =============================================================================

// 当前脚本所在目录 = self-learning-agent/scripts/
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
// 工作区根 = self-learning-agent/
const WORKSPACE_ROOT = path.resolve(SELF_DIR, "..");

// 颜色 / 重置 / emoji
const C = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};
const E = {
  ok: "+",
  warn: "!",
  err: "x",
  info: "i",
  skip: ".",
};

// 锚点正则：匹配 `// @graph: <id>` 或 `// @graph: <id> summary="..."`
// 容忍前导空格、放在行首或行内均可（但只在注释行/独立行识别；多行代码不识别）
// ID 字符集：step./concept./param. 前缀 + 小写字母/数字/下划线
const ANCHOR_RE = /^\s*\/\/\s*@graph:\s*((?:step|concept|param)\.[a-z0-9_]+)\s*(.*)$/;
// 摘要片段：summary="..."  或  summary='...'
const SUMMARY_RE = /summary\s*=\s*"([^"]*)"|summary\s*=\s*'([^']*)'/;

// 大幅波动阈值：节点数变化超过 30% 触发警告
const SHRINK_RATIO = 0.3;

// =============================================================================
// CLI 参数解析
// =============================================================================

function parseArgs(argv) {
  const out = { project: null, apply: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--apply") {
      out.apply = true;
    } else if (a.startsWith("--project=")) {
      out.project = a.slice("--project=".length);
    } else if (a === "--project") {
      out.project = argv[++i];
    } else if (!a.startsWith("--") && !out.project) {
      // 兜底：允许直接传项目名（不是以 -- 开头的第一个参数）
      out.project = a;
    } else {
      console.warn(`${C.yellow}${E.warn}${C.reset} 忽略未知参数: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
用法: node sync-graph.mjs --project=<name> [--apply]

参数:
  --project=<milvus-test|memory-test>   目标项目名（必填）
  --apply                               写盘模式（默认只 diff 不写）
  -h, --help                            显示帮助

示例:
  cd self-learning-agent/memory-test
  pnpm graph:sync          # 打印彩色 diff
  pnpm graph:apply         # 写盘 + 备份 graph.json.bak
`);
}

// =============================================================================
// 工具函数
// =============================================================================

/** 打印带颜色 + emoji 的行 */
function line(color, emoji, text) {
  console.log(`${color}${emoji}${C.reset} ${text}`);
}

/** 拼接 impl_lines 字段：单行用 N，多行用 A-B */
function formatLines(start, end) {
  return start === end ? String(start) : `${start}-${end}`;
}

/** 把字符串统一为 LF（防止 CRLF 错算行号） */
function normalizeNewlines(s) {
  return s.replace(/\r\n/g, "\n");
}

/** 安全读 JSON；失败抛错 */
function readJSON(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

/** 安全写 JSON：保留缩进 2 空格 + 行尾 \n */
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/** 从源文件里扫描所有 // @graph: 锚点 */
function scanAnchors(srcDir) {
  const result = []; // [{ id, file, line, summary? }]
  const errs = [];   // 锚点格式错误
  if (!fs.existsSync(srcDir)) {
    return { anchors: result, errs };
  }
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"))
    .filter((f) => !f.startsWith(".")); // 跳过 .DS_Store 之类

  for (const f of files) {
    const full = path.join(srcDir, f);
    if (!fs.statSync(full).isFile()) continue;
    const text = normalizeNewlines(fs.readFileSync(full, "utf8"));
    const totalLines = text.split("\n").length;
    const lines = text.split("\n");
    lines.forEach((raw, idx) => {
      const m = ANCHOR_RE.exec(raw);
      if (!m) return;
      const id = m[1];
      const rest = (m[2] || "").trim();
      // ID 前缀合法性已由 ANCHOR_RE 强制（必须 step./concept./param.）
      let summary;
      const sm = SUMMARY_RE.exec(rest);
      if (sm) summary = sm[1] || sm[2];
      result.push({
        id,
        file: `src/${f}`,
        line: idx + 1,
        summary,
        _totalLines: totalLines, // 临时透传给 deriveLineRanges
      });
    });
  }
  // 按 (file, line) 排序
  result.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
  return { anchors: result, errs };
}

/** 根据锚点序列计算每段的 impl_lines */
function deriveLineRanges(anchors) {
  // 同文件内按 line 升序；不同文件分开处理
  const ranges = []; // [{ id, file, startLine, endLine, summary }]
  // 按文件分组
  const byFile = new Map();
  for (const a of anchors) {
    if (!byFile.has(a.file)) byFile.set(a.file, []);
    byFile.get(a.file).push(a);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.line - b.line);
    list.forEach((a, i) => {
      const start = a.line;
      const end =
        i + 1 < list.length
          ? list[i + 1].line - 1
          : a._totalLines; // 文件末尾哨兵：取文件总行数
      ranges.push({
        id: a.id,
        file,
        startLine: start,
        endLine: end,
        summary: a.summary,
      });
    });
  }
  return ranges;
}

// =============================================================================
// 核心 diff 逻辑
// =============================================================================

function diffGraph(seedGraph, anchors, errs) {
  const ranges = deriveLineRanges(anchors);
  const knownIds = new Set(seedGraph.nodes.map((n) => n.id));

  // 分桶
  const updates = []; // 绿：已存在节点 + 行号有变化
  const candidates = []; // 黄：锚点不在种子中
  const orphans = []; // 红：种子节点没有任何锚点

  // 1) 锚点 → 节点
  for (const r of ranges) {
    const lineField = formatLines(r.startLine, r.endLine);
    if (knownIds.has(r.id)) {
      const node = seedGraph.nodes.find((n) => n.id === r.id);
      const oldLines = node.impl_lines;
      const oldFile = node.impl_file;
      const newFile = r.file;
      const changed =
        oldLines !== lineField || oldFile !== newFile || (r.summary && node.summary !== r.summary);
      updates.push({
        id: r.id,
        node,
        newFile,
        newLines: lineField,
        newSummary: r.summary,
        oldFile,
        oldLines,
        changed,
      });
    } else {
      candidates.push({ id: r.id, file: r.file, lines: lineField, summary: r.summary });
    }
  }

  // 2) 种子节点 → 锚点（反向检查，标记孤儿）
  const anchoredIds = new Set(ranges.map((r) => r.id));
  for (const node of seedGraph.nodes) {
    if (!anchoredIds.has(node.id)) {
      orphans.push({ id: node.id, file: node.impl_file, lines: node.impl_lines });
    }
  }

  return { updates, candidates, orphans, ranges };
}

// =============================================================================
// 输出 diff
// =============================================================================

function printDiff(seedGraph, diff, project) {
  const { updates, candidates, orphans, ranges, errs } = diff;
  const anchorsCount = ranges.length;

  console.log(
    `\n${C.bold}${C.cyan}=== 知识图谱同步 diff：${project} ===${C.reset}`
  );
  console.log(
    `${C.gray}${E.info} 节点总数：${seedGraph.nodes.length} | 锚点：${updates.length + candidates.length} | 待写盘：${updates.filter((u) => u.changed).length}${C.reset}\n`
  );

  // 零锚点降级提示：源码里还没加任何 // @graph: 锚点，避免孤儿列表刷屏吓到用户
  if (anchorsCount === 0) {
    console.log(
      `${C.yellow}${E.warn}${C.reset} 未在 ${C.bold}src/*.mjs${C.reset} 里发现任何 ${C.cyan}// @graph: <id>${C.reset} 锚点。`
    );
    console.log(
      `${C.gray}  这是预期状态（项目还没开始铺锚点）。孤儿列表仅作参考，等你手动加锚点后再跑一次就会收敛。${C.reset}\n`
    );
  }

  // 大幅波动警告
  const anchoredCount = updates.length + candidates.length;
  if (
    anchoredCount > 0 &&
    seedGraph.nodes.length > 0 &&
    anchoredCount < seedGraph.nodes.length * (1 - SHRINK_RATIO)
  ) {
    console.log(
      `${C.red}${E.warn} 警告：锚点覆盖节点数 (${anchoredCount}) 远少于种子节点数 (${seedGraph.nodes.length})，可能脚本没扫到所有 .mjs，或大量节点已下线。请人工核对。${C.reset}\n`
    );
  }

  // 锚点语法错误
  if (errs && errs.length > 0) {
    console.log(`${C.red}${C.bold}-- 锚点语法错误 (${errs.length}) --${C.reset}`);
    for (const e of errs) {
      console.log(
        `  ${C.red}${E.err}${C.reset} ${e.file}:${e.line}  id="${e.id}"  ${e.reason}`
      );
    }
    console.log();
  }

  // 绿：回填
  const changedUpdates = updates.filter((u) => u.changed);
  console.log(`${C.green}${C.bold}-- 回填 (${changedUpdates.length}) --${C.reset}`);
  if (changedUpdates.length === 0) {
    console.log(`  ${C.gray}${E.skip} 无${C.reset}`);
  } else {
    for (const u of changedUpdates) {
      const oldRange = `${u.oldFile || "?"}:${u.oldLines || "?"}`;
      console.log(
        `  ${C.green}${E.ok}${C.reset} ${u.id}  ${C.gray}${oldRange}${C.reset} -> ${C.green}${u.newFile}:${u.newLines}${C.reset}`
      );
      if (u.newSummary) {
        console.log(`    ${C.gray}summary: ${u.newSummary}${C.reset}`);
      }
    }
  }
  console.log();

  // 黄：候选新增
  console.log(`${C.yellow}${C.bold}-- 候选新增 (${candidates.length}) --${C.reset}`);
  if (candidates.length === 0) {
    console.log(`  ${C.gray}${E.skip} 无${C.reset}`);
  } else {
    for (const c of candidates) {
      console.log(
        `  ${C.yellow}${E.warn}${C.reset} ${c.id}  ${C.gray}@ ${c.file}:${c.lines}${C.reset}`
      );
      console.log(
        `    ${C.gray}模板:${C.reset} { "id": "${c.id}", "label": "TODO", "category": "${c.id.split(".")[0]}", "summary": "${c.summary || "TODO"}", "impl_file": "${c.file}", "impl_lines": "${c.lines}", "api": null }`
      );
    }
  }
  console.log();

  // 红：孤儿
  console.log(`${C.red}${C.bold}-- 种子孤儿 (${orphans.length}) --${C.reset}`);
  if (orphans.length === 0) {
    console.log(`  ${C.gray}${E.skip} 无${C.reset}`);
  } else {
    console.log(
      `  ${C.gray}(下列节点在源码中找不到 // @graph: <id> 锚点；如确为已下线，可手工从 graph.json 删除)${C.reset}`
    );
    for (const o of orphans) {
      console.log(
        `  ${C.red}${E.err}${C.reset} ${o.id}  ${C.gray}@ ${o.file || "?"}:${o.lines || "?"}${C.reset}`
      );
    }
  }
  console.log();
}

// =============================================================================
// 写盘 + 校验 + 回滚
// =============================================================================

function applyUpdates(seedGraph, diff, projectDir) {
  const { updates } = diff;
  const changedUpdates = updates.filter((u) => u.changed);

  if (changedUpdates.length === 0) {
    console.log(`${C.gray}${E.info} 没有需要回填的字段，graph.json 未变更。${C.reset}`);
    return { changed: false, count: 0 };
  }

  const graphPath = path.join(projectDir, "knowledge-graph", "graph.json");
  const bakPath = path.join(projectDir, "knowledge-graph", "graph.json.bak");

  // 备份
  fs.copyFileSync(graphPath, bakPath);
  console.log(`${C.cyan}${E.info}${C.reset} 已备份 -> ${path.relative(projectDir, bakPath)}`);

  // 改内存中的对象
  for (const u of changedUpdates) {
    u.node.impl_file = u.newFile;
    u.node.impl_lines = u.newLines;
    if (u.newSummary) {
      u.node.summary = u.newSummary;
    }
  }

  // 写盘
  try {
    writeJSON(graphPath, seedGraph);
  } catch (err) {
    // 写盘失败 -> 尝试从备份恢复
    fs.copyFileSync(bakPath, graphPath);
    throw new Error(`写盘失败，已从备份恢复: ${err.message}`);
  }

  // 校验：重新读 + JSON.parse
  try {
    const reread = readJSON(graphPath);
    if (!reread || !Array.isArray(reread.nodes)) {
      throw new Error("JSON 结构异常（无 nodes 数组）");
    }
  } catch (err) {
    fs.copyFileSync(bakPath, graphPath);
    throw new Error(`写盘后校验失败，已从备份恢复: ${err.message}`);
  }

  console.log(
    `${C.green}${E.ok}${C.reset} 已写盘 ${changedUpdates.length} 处回填 -> ${path.relative(projectDir, graphPath)}`
  );
  return { changed: true, count: changedUpdates.length };
}

// =============================================================================
// 主流程
// =============================================================================

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.project) {
    console.error(`${C.red}${E.err}${C.reset} 缺少 --project=<name>`);
    printHelp();
    process.exit(1);
  }

  const projectDir = path.join(WORKSPACE_ROOT, args.project);
  if (!fs.existsSync(projectDir)) {
    console.error(`${C.red}${E.err}${C.reset} 项目目录不存在: ${projectDir}`);
    process.exit(1);
  }
  const graphPath = path.join(projectDir, "knowledge-graph", "graph.json");
  if (!fs.existsSync(graphPath)) {
    console.error(`${C.red}${E.err}${C.reset} 未找到 graph.json: ${graphPath}`);
    process.exit(1);
  }

  // 读种子
  let seed;
  try {
    seed = readJSON(graphPath);
  } catch (err) {
    console.error(`${C.red}${E.err}${C.reset} graph.json 解析失败: ${err.message}`);
    process.exit(1);
  }

  // 扫描锚点
  const { anchors, errs } = scanAnchors(path.join(projectDir, "src"));

  // diff
  const diff = diffGraph(seed, anchors, errs);

  // 打印
  printDiff(seed, diff, args.project);

  // 写盘（可选）
  if (args.apply) {
    const result = applyUpdates(seed, diff, projectDir);
    if (result.changed) {
      console.log(
        `\n${C.bold}${C.green}=== 完成：${result.count} 处回填已生效 ===${C.reset}`
      );
    } else {
      console.log(`\n${C.gray}=== 无变更 ===${C.reset}`);
    }
  } else {
    console.log(
      `\n${C.gray}${E.info} 仅打印 diff，未写盘。加 ${C.bold}--apply${C.reset}${C.gray} 或用 ${C.bold}pnpm graph:apply${C.reset}${C.gray} 生效。${C.reset}`
    );
  }
}

try {
  main();
} catch (err) {
  console.error(`${C.red}${E.err}${C.reset} ${err.message}`);
  process.exit(1);
}