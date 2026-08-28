#!/usr/bin/env node
/**
 * eval:qa 编排脚本（STAGE-09）
 *
 * 真实串起「TS runner 执行 → 真实调用 Skill eval_score_aggregate.py 汇总/对比 →
 * 转型为前端 comparison.json → TS 契约自检 → TS 可复现自检」完整链路。
 *
 * 步骤：
 *   1. eval:base   TS 真实跑基线 → output/eval/base.{report,results}.json
 *   2. eval:after  TS 真实跑优化 → output/eval/after.{report,results}.json
 *   3. 真实调用 Skill 脚本 eval_score_aggregate.py：
 *        a) 单份汇总 base.results.json + after.results.json（终端打印，锁定低分）
 *        b) --compare base.results.json after.results.json（回归对比，打印涨/跌/持平）
 *       stdout 交给 transform-comparison.mjs 映射为前端契约 comparison.json
 *   4. eval:contract  TS 运行时评估器契约自检
 *   5. eval:repro     TS 可复现三件套 + 两次运行 SHA 一致性自检
 *
 * 任何一步失败（非零退出）即中止并返回非零，供 CI 门禁。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = (cmd) => ["pnpm", "--filter", "@llmwiki/api", ...cmd.split(" ")];
const SKILL = join(
  ROOT,
  ".agents/skills/agent-evaluation-pack/scripts",
  "eval_score_aggregate.py",
);

function run(label, args, opts = {}) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`✗ ${label} 失败（exit=${r.status}），中止。`);
    process.exit(r.status ?? 1);
  }
  return r;
}

function runCapture(label, args) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    console.error(`✗ ${label} 失败（exit=${r.status}），中止。`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

// 1 + 2：基线 + 优化
run("1/5 跑基线评估（base）", PKG("eval:base"));
run("2/5 跑优化评估（after）", PKG("eval:after"));

// 3a：Skill 脚本真实汇总两份成绩单（锁定低分）
run("3/5 Skill eval_score_aggregate.py 单份汇总 base", [
  "python3", SKILL, join(ROOT, "output/eval/base.results.json"),
]);
run("3/5 Skill eval_score_aggregate.py 单份汇总 after", [
  "python3", SKILL, join(ROOT, "output/eval/after.results.json"),
]);

// 3b：Skill 脚本真实回归对比，输出转 comparison.json
const cmpStdout = runCapture(
  "3/5 Skill eval_score_aggregate.py --compare 回归对比",
  ["python3", SKILL, "--compare", join(ROOT, "output/eval/base.results.json"), join(ROOT, "output/eval/after.results.json")],
);
console.log(cmpStdout);
const tf = spawnSync("node", [join(ROOT, "apps/api/scripts/transform-comparison.mjs")], {
  cwd: ROOT,
  input: cmpStdout,
  encoding: "utf8",
});
if (tf.status !== 0) {
  console.error("transform-comparison 失败");
  process.exit(tf.status ?? 1);
}
console.log(tf.stdout);

// 4 + 5：契约 + 可复现自检
run("4/5 TS 评估器契约自检", PKG("eval:contract"));
run("5/5 TS 可复现三件套自检", PKG("eval:repro"));

console.log("\n✅ eval:qa 完整链路全部通过 ✔");
