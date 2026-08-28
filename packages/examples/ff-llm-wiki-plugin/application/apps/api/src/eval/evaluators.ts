import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  EvalCase,
  EvalScore,
  QaResponse,
} from '@llmwiki/contracts'
import type { WikiManifest } from '../wiki/compiler.js'
import { RAW_DIR } from '../wiki/paths.js'

/**
 * 多维评估器（STAGE-09）
 *
 * 每个评估器统一返回 {key, score, comment}，不适用样本返回 score=null（聚合跳过，
 * 不得用 0 污染分母）。判定收紧：命中≠结果对、过程与结果分开、引用必须真实可打开。
 *
 * 七个评估器对齐七类覆盖度角度（见 Skill agent-eval-coverage-accepting.md）：
 *   answer_completed   任务结果
 *   retrieval_hit      工具与动作（检索命中期望页）
 *   evidence_coverage  依据与状态一致性（回答覆盖期望语义）
 *   citation_valid     依据与状态一致性（引用存在且可打开、片段真实）
 *   answer_faithful    依据与状态一致性（回答忠于证据，角标对账）
 *   no_answer_honest   过程轨迹 / 规则安全（无答案诚实，不编造）
 *   input_robust       抗扰与回归（异常/噪声输入稳健）
 */

/** 评估上下文：真实检索输出 + 结构化的参考答案 + 语料 manifest */
export interface EvalContext {
  question: string
  c: EvalCase
  qa: QaResponse
  manifest: WikiManifest
}

/** 评估器签名：对单个用例返回该指标的一个得分（不适用 score=null） */
export type Evaluator = (ctx: EvalContext) => EvalScore

const slugSet = (m: WikiManifest) => new Set(m.pages.map(p => p.slug))

/** 从回答全部文本里判断是否覆盖某个关键词（大小写无关、子串命中） */
function coversAnswer(qa: QaResponse, keywords: string[]): boolean {
  const text = qa.answers.map(a => a.text).join('\n').toLowerCase()
  return keywords.every(k => text.includes(k.toLowerCase()))
}

/** 判断某引用是否真实存在于 manifest 且片段为真实原文 */
function citationReal(qa: QaResponse, manifest: WikiManifest): boolean {
  const pages = new Map(manifest.pages.map(p => [p.slug, p]))
  for (const cite of qa.citations) {
    const page = pages.get(cite.pageSlug)
    if (!page) return false
    const pool =
      cite.origin === 'conclusion'
        ? page.conclusion
        : page.sourceEvidence.flatMap(e => e.points)
    if (!pool.includes(cite.snippet)) return false
  }
  return true
}

/** 引用 sourcePath 是否指向真实存在的原始文件（evidence origin 才要求） */
function citationOpenable(qa: QaResponse): boolean {
  return qa.citations.every((c) => {
    if (c.origin === 'evidence') {
      if (!c.sourcePath) return false
      return existsSync(join(RAW_DIR, c.sourcePath.replace(/^raw\//, '')))
    }
    return true // 结论片段回指编译页，无需源文件
  })
}

/** 回答角标 [n] 与 citations.id 是否一一对账（不编造、不脱节） */
function citationReconciled(qa: QaResponse): boolean {
  const ids = new Set(qa.citations.map(c => c.id))
  const used = new Set<number>()
  for (const a of qa.answers) {
    for (const n of a.citations) used.add(n)
  }
  if (used.size !== ids.size) return false
  for (const n of used) if (!ids.has(n)) return false
  return true
}

/** 任务结果：期望状态达成（answered 有答案 / no_evidence 诚实不为空答案） */
function answerCompleted({ c, qa }: EvalContext): EvalScore {
  const key = 'answer_completed'
  if (c.expectStatus === 'answered') {
    const ok = qa.status === 'answered' && qa.answers.length >= 1 && qa.citations.length >= 1
    return {
      key,
      score: ok ? 1 : 0,
      comment: ok
        ? `回答完成：${qa.answers.length} 段 + ${qa.citations.length} 条引用`
        : `期望 answered 但状态=${qa.status}（answers=${qa.answers.length}, citations=${qa.citations.length}）`,
    }
  }
  const ok = qa.status === 'no_evidence' && qa.answers.length === 0 && qa.citations.length === 0
  return {
    key,
    score: ok ? 1 : 0,
    comment: ok ? '无证据诚实：answers/citations 均为空' : '期望 no_evidence 却返回了答案（编造）',
  }
}

/** 工具与动作：检索是否命中期望页（只对期望 answered 的用例适用） */
function retrievalHit({ c, qa }: EvalContext): EvalScore {
  const key = 'retrieval_hit'
  if (c.expectStatus !== 'answered' || !c.expectPageSlugs?.length) {
    return { key, score: null, comment: '不适用：非期望 answered 或无期望页' }
  }
  const hitSlugs = new Set(qa.citations.map(x => x.pageSlug))
  if (qa.status !== 'answered') {
    return { key, score: 0, comment: `检索未命中：status=${qa.status}` }
  }
  const missed = c.expectPageSlugs.filter(s => !hitSlugs.has(s))
  if (missed.length === 0) {
    return { key, score: 1, comment: `命中全部期望页（${c.expectPageSlugs.join(', ')}）` }
  }
  return { key, score: 0, comment: `未命中期望页：${missed.join(', ')}（实际命中 ${[...hitSlugs].join(', ') || '无'}）` }
}

/** 依据一致性：回答是否覆盖期望语义关键词（只对期望 answered 适用） */
function evidenceCoverage({ c, qa }: EvalContext): EvalScore {
  const key = 'evidence_coverage'
  if (c.expectStatus !== 'answered' || !c.expectAnswerCovers?.length) {
    return { key, score: null, comment: '不适用：非期望 answered 或无语义关键词' }
  }
  if (qa.status !== 'answered') {
    return { key, score: 0, comment: '证据不足，无法覆盖语义' }
  }
  const ok = coversAnswer(qa, c.expectAnswerCovers)
  return {
    key,
    score: ok ? 1 : 0,
    comment: ok
      ? `覆盖期望语义：${c.expectAnswerCovers.join('、')}`
      : `未覆盖关键词：${c.expectAnswerCovers.filter(k => !qa.answers.map(a => a.text).join('\n').toLowerCase().includes(k.toLowerCase())).join('、')}`,
  }
}

/** 依据一致性：引用是否真实存在且可打开（所有 answered 用例适用） */
function citationValid({ c, qa, manifest }: EvalContext): EvalScore {
  const key = 'citation_valid'
  if (c.expectStatus !== 'answered' || qa.status !== 'answered') {
    return { key, score: null, comment: '不适用：无引用可校验' }
  }
  if (!citationReal(qa, manifest)) {
    return { key, score: 0, comment: '存在引用片段非真实原文或指向不存在的页' }
  }
  if (!citationOpenable(qa)) {
    return { key, score: 0, comment: 'evidence 引用 sourcePath 缺失或指向不存在的源文件' }
  }
  return { key, score: 1, comment: `引用 ${qa.citations.length} 条全部真实且可打开` }
}

/** 依据一致性：回答是否忠于证据（角标对账，不编造不脱节） */
function answerFaithful({ c, qa }: EvalContext): EvalScore {
  const key = 'answer_faithful'
  if (c.expectStatus !== 'answered' || qa.status !== 'answered') {
    return { key, score: null, comment: '不适用：无回答可核' }
  }
  const ok = citationReconciled(qa)
  return {
    key,
    score: ok ? 1 : 0,
    comment: ok ? '回答 [n] 角标与引用一一对账' : '回答角标与引用编号不对账（脱节/多标/缺标）',
  }
}

/** 过程/安全：无答案是否诚实（只对期望 no_evidence 的用例适用） */
function noAnswerHonest({ c, qa }: EvalContext): EvalScore {
  const key = 'no_answer_honest'
  if (c.expectStatus !== 'no_evidence') {
    return { key, score: null, comment: '不适用：本用例期望有答案' }
  }
  const ok = qa.status === 'no_evidence' && qa.answers.length === 0
  return {
    key,
    score: ok ? 1 : 0,
    comment: ok
      ? `诚实标注 no_evidence，附 ${qa.fallback.length} 条可核查资料`
      : `未诚实：status=${qa.status}（应 no_evidence）`,
  }
}

/** 抗扰回归：异常/噪声输入不抛错且给出合理状态（所有用例适用） */
function inputRobust({ c, qa }: EvalContext): EvalScore {
  const key = 'input_robust'
  // 纯标点/无有效词元的输入必须落入 no_evidence，而非假回答
  if (c.kind === 'adversarial' && c.expectStatus === 'no_evidence') {
    const ok = qa.status === 'no_evidence'
    return {
      key,
      score: ok ? 1 : 0,
      comment: ok ? '纯标点输入稳健落入 no_evidence' : `噪声输入未稳健处理：status=${qa.status}`,
    }
  }
  if (c.kind === 'adversarial') {
    const ok = qa.status === 'answered' && qa.answers.length >= 1
    return {
      key,
      score: ok ? 1 : 0,
      comment: ok ? '含噪口语仍稳健命中' : `含噪输入未命中：status=${qa.status}`,
    }
  }
  // 对普通用例，稳健 = 状态落在合法枚举（answered 或 no_evidence）
  const ok = qa.status === 'answered' || qa.status === 'no_evidence'
  return { key, score: ok ? 1 : 0, comment: ok ? `状态合法：${qa.status}` : '状态非法' }
}

/** 全部评估器（顺序稳定，供 coverage 自检与逐例打分） */
export const EVALUATORS: Record<string, Evaluator> = {
  answer_completed: answerCompleted,
  retrieval_hit: retrievalHit,
  evidence_coverage: evidenceCoverage,
  citation_valid: citationValid,
  answer_faithful: answerFaithful,
  no_answer_honest: noAnswerHonest,
  input_robust: inputRobust,
}

/** 对单个用例跑全部评估器，摊平为 EvalScore 列表 */
export function evaluateCase(ctx: EvalContext): EvalScore[] {
  const out: EvalScore[] = []
  for (const fn of Object.values(EVALUATORS)) {
    out.push(fn(ctx))
  }
  return out
}

export { slugSet }
