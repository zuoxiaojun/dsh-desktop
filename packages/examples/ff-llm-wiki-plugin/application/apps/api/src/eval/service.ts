import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  EvalComparison,
  EvalLatestResponse,
  EvalReport,
} from '@llmwiki/contracts'
import { findRepoRoot } from '../wiki/paths.js'

/**
 * 评估报告服务：只读真实产物文件 output/eval/*.json，不写死任何漂亮成绩单。
 * 供 /evaluation 页与 GET /api/evaluation/latest 消费。
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = findRepoRoot(MODULE_DIR)
const EVAL_OUT_DIR = join(REPO_ROOT, 'output', 'eval')

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return null
  }
}

/** 读取最近一次报告（优先 after，否则 base） */
export function readLatestReport(): { report: EvalReport | null; runId: string } {
  const after = readJson<EvalReport>(join(EVAL_OUT_DIR, 'after.report.json'))
  if (after) return { report: after, runId: 'after' }
  const base = readJson<EvalReport>(join(EVAL_OUT_DIR, 'base.report.json'))
  if (base) return { report: base, runId: 'base' }
  return { report: null, runId: '' }
}

/** 读取优化基准（base 报告，用于优化前后对比） */
export function readBaseline(): EvalReport | null {
  return readJson<EvalReport>(join(EVAL_OUT_DIR, 'base.report.json'))
}

/**
 * 读取优化前后对比（由 Skill eval_score_aggregate.py --compare 真实产出）。
 * 若脚本尚未运行（缺少 comparison.json），则回退为 null，页面据实展示「暂无对比」。
 */
export function readComparison(): EvalComparison | null {
  return readJson<EvalComparison>(join(EVAL_OUT_DIR, 'comparison.json'))
}

/** 组装最新报告响应 */
export function getLatestEval(): EvalLatestResponse {
  const latest = readLatestReport()
  const baseline = readBaseline()
  const comparison = readComparison()
  return {
    report: latest.report,
    baseline,
    comparison,
  }
}
