import { runEval } from './runner.js'

/**
 * 评估 CLI：`pnpm eval:qa [base|after]`
 *
 * 真实执行评估（TS runner）并写出真实产物：
 *   output/eval/<runId>.report.json  完整报告（前端 /evaluation 数据源）
 *   output/eval/<runId>.results.json 逐例打分（Skill eval_score_aggregate.py 输入）
 *
 * 汇总与回归对比由 Skill 原脚本 eval_score_aggregate.py 消费 results.json 完成，
 * 见根 package.json 的 eval:qa 脚本串联。
 */
const runId = (process.argv[2] ?? 'base') as 'base' | 'after'
if (runId !== 'base' && runId !== 'after') {
  console.error('用法: tsx src/eval/cli.ts [base|after]')
  process.exit(2)
}

const report = runEval(runId)
console.log(
  `[eval:${runId}] 完成：${report.caseCount} 题，通过 ${report.passed}，总分 ${report.totalScore}，耗时 ${report.elapsedMs}ms`,
)
console.log('  逐指标均分：')
for (const [k, v] of Object.entries(report.metricMeans)) {
  console.log(`    ${k}: ${v.mean} (n=${v.n})`)
}
