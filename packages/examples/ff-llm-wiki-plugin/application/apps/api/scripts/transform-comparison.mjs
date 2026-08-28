#!/usr/bin/env node
/**
 * 把 Skill eval_score_aggregate.py --compare 的真实输出映射为前端契约
 * EvalComparison（仅字段重命名 + 过滤内部字段，不重算、不造数）。
 *
 * 输入：stdin（Skill 脚本的 JSON stdout）
 * 输出：output/eval/comparison.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const stdin = readFileSync(0, "utf8");
let raw;
try {
  raw = JSON.parse(stdin);
} catch (e) {
  console.error("对比脚本输出非 JSON，跳过 comparison 生成", e);
  process.exit(0);
}

const out = {
  regressionFree: raw.regression_free ?? false,
  regressions: raw.regressions ?? [],
  metrics: (raw.metrics ?? []).map((m) => ({
    key: m.key,
    before: m.before ?? null,
    after: m.after ?? null,
    trend: m.trend ?? "仅一侧有",
  })),
};

const dir = join(process.cwd(), "output", "eval");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "comparison.json"), JSON.stringify(out, null, 2));
console.log(`comparison.json 已生成：regressionFree=${out.regressionFree}，指标 ${out.metrics.length} 项`);
