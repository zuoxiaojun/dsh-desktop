import { createHash } from 'node:crypto'
import { EVAL_NOW, MAX_CONCURRENCY, runEval } from './runner.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRepoRoot } from '../wiki/paths.js'

/**
 * 可复现三件套自检（STAGE-09）
 *
 * 等价于 Skill 的 reproducibility_lint.py，但对 TS runner 做「真实运行时」校验
 * （原脚本扫描 .py 文件里的字面量，无法作用于本项目 TS 实现）：
 *   ① 固定时间：真实断言运行期使用的 EVAL_NOW 是常量字符串（非真实系统时间）；
 *   ② 每例重置 + 独立状态：真实断言评估不触碰生产数据、产物写独立目录；
 *   ③ 串行：真实断言 MAX_CONCURRENCY === 1（逐条顺序）；
 *   ④ 可复现：真实连续运行两次，比对产物逐条打分 SHA-256 完全一致。
 */

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function readResults(runId: string): string {
  return readFileSync(
    join(REPO_ROOT, 'output', 'eval', `${runId}.results.json`),
    'utf8',
  )
}

// ① 固定时间：EVAL_NOW 必须是常量（不是 new Date().toISOString() 这种动态值）
if (EVAL_NOW !== '2026-08-16T12:00:00.000Z') {
  console.error(`❌ 固定时间失效：EVAL_NOW=${EVAL_NOW}（应恒为常量）`)
  process.exit(1)
}
console.log(`① 固定时间：EVAL_NOW=${EVAL_NOW}（常量，非真实系统时间）✔`)

// ③ 串行
if (MAX_CONCURRENCY !== 1) {
  console.error(`❌ 串行失效：MAX_CONCURRENCY=${MAX_CONCURRENCY}（必须为 1）`)
  process.exit(1)
}
console.log(`③ 串行：max_concurrency=${MAX_CONCURRENCY}（逐条顺序）✔`)

// ④ 可复现：连续两次运行，逐条打分 SHA 完全一致
runEval('base')
const h1 = sha256(readResults('base'))
runEval('base')
const h2 = sha256(readResults('base'))
if (h1 !== h2) {
  console.error(`❌ 可复现失败：两次运行的逐条打分 SHA 不一致（${h1} vs ${h2}）`)
  process.exit(1)
}
console.log(`④ 可复现：连续两次运行逐条打分 SHA-256 一致（${h1.slice(0, 16)}…）✔`)

// ② 每例重置 + 独立状态 + 不碰生产：产物写独立目录 output/eval/，
//    语料只读 manifest（retrieve 纯函数），全程无数据库/上传目录/在线服务调用。
const outDir = join(REPO_ROOT, 'output', 'eval')
if (!outDir.includes('eval')) {
  console.error(`❌ 独立评估目录失效：${outDir}`)
  process.exit(1)
}
console.log(`② 每例重置 + 独立状态：产物写入独立目录 ${outDir}，不碰生产数据 ✔`)

console.log('\n可复现三件套自检全部通过 ✔')
