import type {
  QaAnswer,
  QaCitation,
  QaConfidence,
  QaFallbackItem,
  QaResponse,
  QaStatus,
  WikiPageType,
} from '@llmwiki/contracts'
import type { WikiManifest, ManifestPage } from '../wiki/compiler.js'

/**
 * 可溯源问答 · 本地加权检索 + 重排（STAGE-08）
 *
 * 只消费编译产物 manifest（47 篇 Wiki、98 引用及结论/来源证据片段）。
 * 不调用大模型、不联网：答案由命中的真实片段拼装，缺证据诚实说「没有足够证据」。
 * 检索与重排均为确定性纯函数，同输入必同输出（可复现，可单测对账）。
 */

/** 候选片段（一个可被引用的真实文本单元） */
interface Candidate {
  page: ManifestPage
  /** 片段文本（真实原文） */
  text: string
  /** 片段来源：知识页结论 / 某来源证据点 */
  origin: 'conclusion' | 'evidence'
  /** 来源文档路径（结论为空串，证据点回指 raw/…） */
  sourcePath: string
  /** 片段所属条目标题（结论为页标题，证据点为来源证据标题） */
  ownerTitle: string
  score: number
}

/** 命中并采用的引用（用于组装回答） */
interface Adopted {
  page: ManifestPage
  text: string
  origin: 'conclusion' | 'evidence'
  sourcePath: string
  score: number
}

/** 命中阈值：低于此分视为「相关度不足」，不采用（真实证据答案≥1.0，弱相关约 0.1） */
const ADOPT_MIN_SCORE = 0.5

/** 引用总上限：基线条数（5）+ 增量多样性补充（最多补到 8），避免引用面板无限增长 */
const TOP_K = 5
const DIVERSITY_CAP = 8

/** 加权字段：标题权重最高，结论与证据点次之，slug/summary 兜底 */
const FIELD_WEIGHTS = {
  title: 3.0,
  conclusion: 2.0,
  evidencePoint: 1.6,
  summary: 1.2,
  slug: 0.9,
} as const

/**
 * 中文/英文通用的词元化（可复现，无外部依赖分词器）：
 * - ASCII 单词 / 数字：整词保留；
 * - 中文连续段：拆成单字（unigram）+ 相邻双字（bigram），
 *   使无空格的中文口语问句也能与片段子串命中（如「数据泄露」）。
 * 问句与片段共用同一口径，保证结果可复现。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  // 先按 ASCII 单词 / 数字切出，其余为 CJK 连续段
  for (const m of lower.matchAll(/[a-z0-9]+|[\u3400-\u9fff\uF900-\uFAFF]+/g)) {
    const seg = m[0]
    if (/^[a-z0-9]+$/.test(seg)) {
      out.push(seg)
    } else {
      // 中文段：若长度 1-2 保留整体；否则拆 bigram（相邻双字），
      // 使无空格中文问句与片段子串命中，避免单字噪声。
      const chars = Array.from(seg)
      if (chars.length <= 2) {
        out.push(seg)
      } else {
        for (let i = 0; i + 1 < chars.length; i++) {
          out.push(chars[i] + chars[i + 1])
        }
      }
    }
  }
  return out
}

/** 单词重叠系数：命中词元加权求和，取两个集合的 Jaccard-like 归一 */
function overlapScore(qTokens: string[], fieldTokens: string[]): number {
  if (qTokens.length === 0 || fieldTokens.length === 0) return 0
  const fieldSet = new Set(fieldTokens)
  let hit = 0
  for (const t of qTokens) if (fieldSet.has(t)) hit += 1
  if (hit === 0) return 0
  // 命中比例 × 词元长度惩罚（短字段不虚高）
  const cover = hit / qTokens.length
  const norm = Math.min(1, qTokens.length / Math.max(1, fieldTokens.length))
  return cover * (0.6 + 0.4 * norm)
}

/** 片段→候选打分（字段加权，可复现） */
function scoreField(qTokens: string[], text: string, weight: number): number {
  const tokens = tokenize(text)
  if (tokens.length === 0) return 0
  return overlapScore(qTokens, tokens) * weight
}

/** 组装候选片段（结论正文每段一条 + 每个来源证据点一条） */
function buildCandidates(manifest: WikiManifest): Candidate[] {
  const out: Candidate[] = []
  for (const page of manifest.pages) {
    for (const text of page.conclusion) {
      out.push({
        page,
        text,
        origin: 'conclusion',
        sourcePath: '',
        ownerTitle: page.title,
        score: 0,
      })
    }
    for (const ev of page.sourceEvidence) {
      for (const text of ev.points) {
        out.push({
          page,
          text,
          origin: 'evidence',
          sourcePath: ev.source,
          ownerTitle: ev.title,
          score: 0,
        })
      }
    }
  }
  return out
}

/** 为所有候选打分并过滤零分 */
function rank(qTokens: string[], candidates: Candidate[]): Candidate[] {
  const scored = candidates.map((c) => {
    const page = c.page
    let s = 0
    s += scoreField(qTokens, page.title, FIELD_WEIGHTS.title)
    if (c.origin === 'conclusion') {
      s += scoreField(qTokens, c.text, FIELD_WEIGHTS.conclusion)
    } else {
      s += scoreField(qTokens, c.text, FIELD_WEIGHTS.evidencePoint)
    }
    s += scoreField(qTokens, page.summary, FIELD_WEIGHTS.summary)
    s += scoreField(qTokens, page.slug, FIELD_WEIGHTS.slug)
    return { ...c, score: s }
  })
  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
}

/** 分数→置信等级（对齐 ADOPT_MIN_SCORE=0.5 的量纲） */
function confidenceOf(score: number): QaConfidence {
  if (score >= 1.8) return 'high'
  if (score >= 0.9) return 'medium'
  return 'low'
}

/** 总体置信：取引用最高档（无引用时 low） */
function overallConfidence(cites: QaCitation[]): QaConfidence {
  const order: QaConfidence[] = ['low', 'medium', 'high']
  let max = 0
  for (const c of cites) {
    const i = order.indexOf(c.confidence)
    if (i > max) max = i
  }
  return order[max]
}

/** 把一组成文本 + 引用组装为回答段落（最多 topK 条，每条带 [n] 角标） */
function assemble(cites: { text: string; n: number }[]): QaAnswer[] {
  return cites.map(({ text, n }) => ({
    text,
    citations: [n],
  }))
}

/**
 * 检索 options：唯一受控变量是「跨页多样性补充」开关。
 *
 * - diversity=false → baseline profile：只采用原 top-K（历史行为，不补多样性）。
 * - diversity=true  → optimized profile：保留 top-K 后，再从剩余高于阈值的
 *   候选中增量补充「尚未出现的页面」代表片段，直到 DIVERSITY_CAP。
 *
 * 两种 profile 共享同一份代码、同一题库、同一评估器、同一阈值与固定时间；
 * 默认值 = true（生产默认行为）。评估时显式分别传 false/true 以重放 base/after。
 */
export interface RetrieveOptions {
  /** 是否在保留 top-K 后增量补跨页代表片段（默认 true = 生产默认） */
  diversity?: boolean
}

const DEFAULT_OPTIONS: Required<RetrieveOptions> = { diversity: true }

/**
 * 核心入口：给定问题，在 manifest 上做确定性检索与重排，返回结构化回答。
 * 纯函数（给定 manifest + question + options 恒返回同一结果）。
 */
export function retrieve(
  manifest: WikiManifest,
  question: string,
  options: RetrieveOptions = {},
): QaResponse {
  const { diversity } = { ...DEFAULT_OPTIONS, ...options }
  const qTokens = tokenize(question)
  const candidates = buildCandidates(manifest)
  const ranked = qTokens.length === 0 ? [] : rank(qTokens, candidates)

  // 第一阶段：原样采用基线的 top-K（越过阈值、去重），不删除既有证据。
  const seen = new Set<string>()
  const seenText = new Set<string>()
  const adopted: Adopted[] = []
  for (const c of ranked) {
    if (c.score < ADOPT_MIN_SCORE) continue
    const key = `${c.page.slug}::${c.text}`
    if (seen.has(key)) continue
    if (seenText.has(c.text)) continue
    seen.add(key)
    seenText.add(c.text)
    adopted.push({
      page: c.page,
      text: c.text,
      origin: c.origin,
      sourcePath: c.sourcePath,
      score: c.score,
    })
    if (adopted.length >= TOP_K) break
  }

  // 第二阶段（仅 diversity=true）：增量补充多样性——从剩余高于阈值、且页面
  // 尚未出现的候选中按分数补代表片段，直到 DIVERSITY_CAP。只增量、不替换 top-K。
  if (diversity && adopted.length > 0) {
    const usedPages = new Set(adopted.map(a => a.page.slug))
    for (const c of ranked) {
      if (adopted.length >= DIVERSITY_CAP) break
      if (c.score < ADOPT_MIN_SCORE) continue
      const key = `${c.page.slug}::${c.text}`
      if (seen.has(key)) continue
      if (seenText.has(c.text)) continue
      if (usedPages.has(c.page.slug)) continue // 已采纳页不再补
      seen.add(key)
      seenText.add(c.text)
      usedPages.add(c.page.slug)
      adopted.push({
        page: c.page,
        text: c.text,
        origin: c.origin,
        sourcePath: c.sourcePath,
        score: c.score,
      })
    }
  }

  // 证据不足：仍有可核查的最相近资料（越过软阈值，未被采用也算）
  const fallback: QaFallbackItem[] = ranked
    .filter(c => c.score > 0)
    .slice(0, 4)
    .map(c => ({
      pageSlug: c.page.slug,
      pageTitle: c.page.title,
      summary: c.page.summary,
      pageType: c.page.type,
      score: Number(c.score.toFixed(3)),
    }))

  if (adopted.length === 0) {
    return {
      status: 'no_evidence',
      answers: [],
      citations: [],
      fallback,
      metrics: {
        searched: manifest.pages.length,
        matched: fallback.length,
        adopted: 0,
      },
      compiledAt: manifest.compiledAt,
      confidence: 'low',
      mode: 'local-weighted-retrieval',
    }
  }

  const citations: QaCitation[] = adopted.map((a, i) => ({
    id: i + 1,
    pageSlug: a.page.slug,
    pageTitle: a.page.title,
    snippet: a.text,
    origin: a.origin,
    sourcePath: a.sourcePath || null,
    pageType: a.page.type,
    score: Number(a.score.toFixed(3)),
    confidence: confidenceOf(a.score),
  }))

  const answers = assemble(adopted.map((a, i) => ({ text: a.text, n: i + 1 })))

  return {
    status: 'answered',
    answers,
    citations,
    fallback: [],
    metrics: {
      searched: manifest.pages.length,
      matched: ranked.length,
      adopted: adopted.length,
    },
    compiledAt: manifest.compiledAt,
    confidence: overallConfidence(citations),
    mode: 'local-weighted-retrieval',
  }
}
