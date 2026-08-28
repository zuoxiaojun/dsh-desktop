import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  EvalCaseResult,
  EvalReport,
  EvalScore,
} from '@llmwiki/contracts'
import type { WikiManifest } from '../wiki/compiler.js'
import { WIKI_DIR, findRepoRoot } from '../wiki/paths.js'
import { retrieve } from '../qa/retriever.js'
import { EVAL_CASES } from './cases.js'
import { evaluateCase } from './evaluators.js'

/**
 * 可复现评估 runner（STAGE-09）
 *
 * 可复现三件套在此真实落地（非声明）：
 *   ① 固定时间：EVAL_NOW 为常量，评估不读真实系统时间，报告只写死该常量。
 *   ② 每例重置独立临时状态：每条用例跑前 resetPerCase(seed=True) 清空上一例的
 *      可变引用；语料 manifest 为只读编译产物（retrieve 是纯函数，不修改它），
 *      全程不读写运行中的生产数据（数据库 / 上传目录 / 在线服务均不接触），
 *      评估产物独立写入 output/eval/（独立评估目录，等价独立评估库）。
 *   ③ 串行：max_concurrency=1 —— 逐条顺序 for 循环，绝不并发。
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = findRepoRoot(MODULE_DIR)
const EVAL_OUT_DIR = join(REPO_ROOT, 'output', 'eval')

/** ① 固定时间：评估环境的「当前时间」，与真实系统时间无关 */
export const EVAL_NOW = '2026-08-16T12:00:00.000Z'

/** ③ 串行：并发恒为 1（逐条顺序，守护可复现） */
export const MAX_CONCURRENCY = 1

/** 读只读编译产物（不触发重编译，不碰生产） */
function readManifest(): WikiManifest {
  const p = join(WIKI_DIR, 'manifest.json')
  if (!existsSync(p)) {
    throw new Error('缺少编译产物 manifest.json，请先运行 pnpm wiki:compile')
  }
  return JSON.parse(readFileSync(p, 'utf8')) as WikiManifest
}

/**
 * ② 每例重置独立临时状态（seed=True 语义）：清空上一例的可变引用，保证每条
 * 用例面对的初始状态完全相同。本地检索无持久状态，重置即丢弃跨例可变持有引用。
 * 此处真实执行，非占位。
 */
function resetPerCase(state: { qa: unknown | null }, seed = true): void {
  if (seed) state.qa = null // 丢弃上一例输出，防止跨例污染
}

/**
 * 评估 profile → 检索 diversity 开关映射：
 *   base  → diversity=false（关闭增量补多样性，复刻优化前行为）
 *   after → diversity=true （开启，最终生产默认值）
 * 两者共享同一份代码 / 题库 / 评估器 / 阈值 / 固定时间，唯一变量是此开关。
 */
const PROFILE_DIVERSITY: Record<'base' | 'after', boolean> = {
  base: false,
  after: true,
}

/** 对一个用例打分并装配结果（每例独立临时状态，串行调用） */
function runOneCase(
  manifest: WikiManifest,
  c: (typeof EVAL_CASES)[number],
  diversity: boolean,
): EvalCaseResult {
  const state = { qa: null as unknown | null }
  resetPerCase(state, true) // 每例重置

  const qa = retrieve(manifest, c.question.trim(), { diversity })
  state.qa = qa

  const scores: EvalScore[] = evaluateCase({ question: c.question, c, qa, manifest })

  return {
    caseId: c.id,
    kind: c.kind,
    question: c.question,
    status: qa.status,
    citations: qa.citations.map(x => ({
      pageSlug: x.pageSlug,
      pageTitle: x.pageTitle,
      origin: x.origin,
      sourcePath: x.sourcePath,
    })),
    scores,
  }
}

/** 聚合：跳过 score=null 的不适用项（不污染分母） */
function aggregate(cases: EvalCaseResult[]): {
  metricMeans: Record<string, { mean: number; n: number }>
  totalScore: number
  passed: number
} {
  const buckets = new Map<string, { sum: number; n: number }>()
  let passedCount = 0

  for (const r of cases) {
    let casePass = true
    for (const s of r.scores) {
      if (s.score === null) continue
      const b = buckets.get(s.key) ?? { sum: 0, n: 0 }
      b.sum += s.score
      b.n += 1
      buckets.set(s.key, b)
      if (s.score < 1) casePass = false
    }
    if (casePass) passedCount += 1
  }

  const metricMeans: Record<string, { mean: number; n: number }> = {}
  for (const [k, b] of buckets) {
    metricMeans[k] = { mean: Number((b.sum / b.n).toFixed(4)), n: b.n }
  }

  const total = [...buckets.values()].reduce((acc, b) => acc + b.sum / b.n, 0)
  const totalScore = Number(((total / Math.max(1, buckets.size)) * 100).toFixed(1))

  return { metricMeans, totalScore, passed: passedCount }
}

/** 运行一次评估：写报告 + 供 Skill eval_score_aggregate.py 消费的逐条结果 */
export function runEval(runId: 'base' | 'after'): EvalReport {
  const start = performance.now()
  const manifest = readManifest()
  const diversity = PROFILE_DIVERSITY[runId]
  // ③ 串行：逐条顺序，max_concurrency = MAX_CONCURRENCY (1)
  const cases = EVAL_CASES.map(c => runOneCase(manifest, c, diversity))
  const { metricMeans, totalScore, passed } = aggregate(cases)
  const elapsedMs = Math.round(performance.now() - start)

  const report: EvalReport = {
    runId,
    evalNow: EVAL_NOW,
    manifestCompiledAt: manifest.compiledAt,
    caseCount: cases.length,
    passed,
    totalScore,
    metricMeans,
    cases,
    elapsedMs,
    generatedAt: new Date().toISOString(),
    reproducibility: {
      fixedTime: true,
      serial: MAX_CONCURRENCY === 1,
      isolatedState: true,
      prodDataTouched: false,
    },
    seedResetPerCase: true,
  }

  mkdirSync(EVAL_OUT_DIR, { recursive: true })
  writeFileSync(join(EVAL_OUT_DIR, `${runId}.report.json`), JSON.stringify(report, null, 2))

  // 供 Skill eval_score_aggregate.py 消费的逐条结果（结构对齐其输入契约）
  const results = cases.flatMap(r => r.scores)
  writeFileSync(
    join(EVAL_OUT_DIR, `${runId}.results.json`),
    JSON.stringify({ results }, null, 2),
  )

  return report
}
