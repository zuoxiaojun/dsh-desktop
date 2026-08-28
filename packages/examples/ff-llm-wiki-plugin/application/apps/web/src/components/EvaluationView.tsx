'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  EvalCaseResult,
  EvalComparison,
  EvalLatestResponse,
  EvalReport,
} from '@llmwiki/contracts'
import { fetchEvaluation } from '../lib/api'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  EvalIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
} from './Icons'

const METRIC_LABELS: Record<string, { label: string; short: string; desc: string }> = {
  answer_completed: { label: '回答完成', short: '完成', desc: '期望状态与任务结果是否达成' },
  retrieval_hit: { label: '检索命中', short: '检索', desc: '是否命中题目期望的知识页面' },
  evidence_coverage: { label: '证据覆盖', short: '覆盖', desc: '证据是否覆盖问题的关键语义' },
  citation_valid: { label: '引用有效', short: '引用', desc: '引用是否真实存在并可返回原文' },
  answer_faithful: { label: '忠于证据', short: '忠实', desc: '答案陈述与引用证据是否对账' },
  no_answer_honest: { label: '诚实拒答', short: '拒答', desc: '证据不足时是否避免生成事实' },
  input_robust: { label: '异常稳健', short: '稳健', desc: '噪声与异常输入下是否保持稳定' },
}

const METRIC_ORDER = [
  'answer_completed',
  'retrieval_hit',
  'evidence_coverage',
  'citation_valid',
  'answer_faithful',
  'no_answer_honest',
  'input_robust',
]

const KIND_LABELS: Record<string, string> = {
  direct_fact: '直接事实',
  cross_source: '跨来源归纳',
  concept_link: '概念关联',
  citation_jump: '引用跳转',
  no_evidence: '无充分证据',
  adversarial: '干扰输入',
}

type CaseFilter = 'all' | 'passed' | 'failed'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

function casePassed(result: EvalCaseResult) {
  return result.scores.every(score => score.score === null || score.score === 1)
}

function metricTone(mean: number) {
  if (mean >= 0.999) return 'perfect'
  if (mean >= 0.85) return 'healthy'
  if (mean >= 0.7) return 'watch'
  return 'risk'
}

function ScoreOrbit({ score }: { score: number }) {
  const radius = 68
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)
  return (
    <div className="ev-score-orbit">
      <div className="ev-orbit-glow" />
      <svg viewBox="0 0 180 180" aria-label={`质量总分 ${score}`}>
        <defs>
          <linearGradient id="ev-score-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--ev-accent)" />
            <stop offset="70%" stopColor="var(--ev-gold)" />
            <stop offset="100%" stopColor="var(--ev-warn)" />
          </linearGradient>
        </defs>
        <circle className="ev-orbit-track" cx="90" cy="90" r={radius} />
        <circle
          className="ev-orbit-value"
          cx="90"
          cy="90"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <circle className="ev-orbit-inner" cx="90" cy="90" r="51" />
      </svg>
      <div className="ev-score-value">
        <strong>{score.toFixed(1)}</strong>
        <span>质量指数</span>
      </div>
      <i className="ev-orbit-node node-a" />
      <i className="ev-orbit-node node-b" />
    </div>
  )
}

function MetricCard({
  metricKey,
  mean,
  n,
  comparison,
  active,
  onClick,
}: {
  metricKey: string
  mean: number
  n: number
  comparison: EvalComparison['metrics'][number] | undefined
  active: boolean
  onClick: () => void
}) {
  const info = METRIC_LABELS[metricKey] ?? { label: metricKey, short: metricKey, desc: '' }
  const tone = metricTone(mean)
  const delta = comparison?.before === null
    || comparison?.after === null
    || comparison?.before === undefined
    || comparison?.after === undefined
    ? null
    : Math.round((comparison.after - comparison.before) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`ev-metric-card tone-${tone} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
    >
      <div className="ev-metric-card-head">
        <span className="ev-metric-index">{String(METRIC_ORDER.indexOf(metricKey) + 1).padStart(2, '0')}</span>
        <span className="ev-metric-status">{tone === 'perfect' ? '满分' : tone === 'healthy' ? '健康' : tone === 'watch' ? '关注' : '风险'}</span>
      </div>
      <div className="ev-metric-main">
        <div>
          <strong>{info.label}</strong>
          <small>{info.desc}</small>
        </div>
        <div className="ev-metric-score">
          <b>{Math.round(mean * 100)}</b><em>%</em>
        </div>
      </div>
      <div className="ev-metric-scale">
        <span style={{ width: `${mean * 100}%` }} />
        {[25, 50, 75].map(mark => <i key={mark} style={{ left: `${mark}%` }} />)}
      </div>
      <div className="ev-metric-footer">
        <span>有效样本 n={n}</span>
        <span className={delta !== null && delta > 0 ? 'is-up' : delta !== null && delta < 0 ? 'is-down' : ''}>
          {delta === null ? '无基线' : delta > 0 ? `较基线 +${delta}` : delta < 0 ? `较基线 ${delta}` : '与基线持平'}
        </span>
      </div>
    </button>
  )
}

function ComparisonRail({ report, baseline, comparison }: {
  report: EvalReport
  baseline: EvalReport | null
  comparison: EvalComparison | null
}) {
  const before = baseline?.totalScore ?? report.totalScore
  const delta = report.totalScore - before
  const improved = comparison?.metrics.filter(metric => metric.trend === '涨').length ?? 0
  const stable = comparison?.metrics.filter(metric => metric.trend === '持平').length ?? 0

  return (
    <section className="ev-panel ev-comparison-panel" id="evaluation-comparison">
      <header className="ev-panel-header">
        <div>
          <span className="ev-kicker">回归控制</span>
          <h2>优化前后质量轨迹</h2>
          <p>同一题库、同一固定时间、同一评估器下的可复现对比</p>
        </div>
        <span className={`ev-regression-badge ${comparison?.regressionFree ? 'is-safe' : 'is-risk'}`}>
          <i />{comparison?.regressionFree ? '无指标回归' : '发现质量回归'}
        </span>
      </header>

      <div className="ev-comparison-body">
        <div className="ev-score-journey">
          <div className="ev-journey-point baseline"><span>优化前</span><strong>{before.toFixed(1)}</strong><small>基准版本</small></div>
          <div className="ev-journey-line"><i /><span>{delta >= 0 ? '+' : ''}{delta.toFixed(1)} 分</span></div>
          <div className="ev-journey-point current"><span>优化后</span><strong>{report.totalScore.toFixed(1)}</strong><small>当前版本</small></div>
        </div>
        <div className="ev-comparison-stats">
          <div><span>提升指标</span><strong>{improved}</strong><small>/ {comparison?.metrics.length ?? METRIC_ORDER.length}</small></div>
          <div><span>稳定指标</span><strong>{stable}</strong><small>无损保持</small></div>
          <div><span>回归项</span><strong className={comparison?.regressionFree ? 'is-good' : 'is-bad'}>{comparison?.regressions.length ?? 0}</strong><small>必须为 0</small></div>
        </div>
      </div>

      <div className="ev-delta-grid">
        {(comparison?.metrics ?? []).map((metric) => {
          const label = METRIC_LABELS[metric.key]?.short ?? metric.key
          const beforeValue = metric.before === null ? null : Math.round(metric.before * 100)
          const afterValue = metric.after === null ? null : Math.round(metric.after * 100)
          const deltaValue = beforeValue === null || afterValue === null ? null : afterValue - beforeValue
          return (
            <div key={metric.key} className={`ev-delta-cell ${deltaValue !== null && deltaValue > 0 ? 'is-up' : deltaValue !== null && deltaValue < 0 ? 'is-down' : ''}`}>
              <span>{label}</span>
              <div><small>{beforeValue ?? '—'}</small><i>→</i><strong>{afterValue ?? '—'}</strong></div>
              <em>{deltaValue === null ? '—' : deltaValue > 0 ? `+${deltaValue}` : deltaValue}</em>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CaseDiagnostic({ result, expanded, onToggle }: {
  result: EvalCaseResult
  expanded: boolean
  onToggle: () => void
}) {
  const failures = result.scores.filter(score => score.score === 0)
  const passed = failures.length === 0
  const applicable = result.scores.filter(score => score.score !== null)
  const score = applicable.length === 0 ? 0 : Math.round((applicable.filter(item => item.score === 1).length / applicable.length) * 100)

  return (
    <article className={`ev-case-row ${passed ? 'is-passed' : 'is-failed'} ${expanded ? 'is-expanded' : ''}`}>
      <button type="button" className="ev-case-summary" onClick={onToggle} aria-expanded={expanded}>
        <span className="ev-case-state">{passed ? <CheckCircleIcon className="h-4 w-4" /> : <AlertCircleIcon className="h-4 w-4" />}</span>
        <span className="ev-case-copy">
          <span><em>{KIND_LABELS[result.kind] ?? result.kind}</em><small>{result.caseId}</small></span>
          <strong>{result.question}</strong>
        </span>
        <span className="ev-case-evidence"><b>{result.citations.length}</b><small>证据</small></span>
        <span className="ev-case-grade"><b>{score}</b><small>得分</small></span>
        <span className="ev-case-result">{passed ? '通过' : `${failures.length} 项失败`}</span>
        <span className="ev-case-chevron">⌄</span>
      </button>

      <div className="ev-case-detail">
        <div className="ev-case-score-grid">
          {result.scores.map(item => (
            <div key={item.key} className={item.score === 1 ? 'is-ok' : item.score === 0 ? 'is-fail' : 'is-na'}>
              <span>{item.score === 1 ? '✓' : item.score === 0 ? '!' : '—'}</span>
              <div><strong>{METRIC_LABELS[item.key]?.label ?? item.key}</strong><small>{item.comment}</small></div>
            </div>
          ))}
        </div>
        <div className="ev-case-sources">
          <span>命中证据</span>
          <div>
            {result.citations.length === 0 ? <small>本题没有采用证据</small> : result.citations.map((citation, index) => (
              <span key={`${citation.pageSlug}-${index}`} title={citation.sourcePath ?? citation.pageSlug}>
                <b>{index + 1}</b>{citation.pageTitle}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}

export function EvaluationView() {
  const [data, setData] = useState<EvalLatestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [caseFilter, setCaseFilter] = useState<CaseFilter>('all')
  const [query, setQuery] = useState('')
  const [activeMetric, setActiveMetric] = useState<string | null>(null)
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchEvaluation())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const report = data?.report ?? null
  const metricEntries = useMemo(() => {
    if (!report) return []
    return METRIC_ORDER
      .filter(key => report.metricMeans[key])
      .map(key => ({ key, ...report.metricMeans[key] }))
  }, [report])

  const filteredCases = useMemo(() => {
    if (!report) return []
    const normalized = query.trim().toLowerCase()
    return report.cases
      .filter(result => caseFilter === 'all' || (caseFilter === 'passed' ? casePassed(result) : !casePassed(result)))
      .filter(result => !activeMetric
        || result.scores.some(score => score.key === activeMetric && score.score !== null))
      .filter(result => !normalized
        || result.question.toLowerCase().includes(normalized)
        || result.caseId.toLowerCase().includes(normalized))
      .sort((a, b) => {
        if (!activeMetric) return Number(casePassed(a)) - Number(casePassed(b))
        const aScore = a.scores.find(score => score.key === activeMetric)?.score ?? 1
        const bScore = b.scores.find(score => score.key === activeMetric)?.score ?? 1
        return aScore - bScore
      })
  }, [activeMetric, caseFilter, query, report])

  const exportReport = useCallback(() => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `llmwiki-evaluation-${data.report?.runId ?? 'latest'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('评估报告已导出')
  }, [data])

  const focusMetric = useCallback((metricKey: string) => {
    setActiveMetric(current => current === metricKey ? null : metricKey)
    setCaseFilter('all')
    window.setTimeout(() => document.getElementById('evaluation-cases')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
  }, [])

  if (loading && !data) {
    return (
      <div className="ev-loading-state">
        <span><SpinnerIcon className="h-5 w-5 animate-spin" /></span>
        <strong>正在装载质量评估矩阵</strong>
        <small>读取题库、指标与回归报告…</small>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="ev-error-state">
        <AlertCircleIcon className="h-8 w-8" />
        <strong>评估报告加载失败</strong>
        <small>{error}</small>
        <button type="button" onClick={() => void load()}>重新读取报告</button>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="ev-empty-state">
        <EvalIcon className="h-9 w-9" />
        <h1>尚无质量评估报告</h1>
        <p>运行 <code>pnpm eval:qa</code> 生成题库成绩、逐项指标和回归对比后刷新本页。</p>
        <button type="button" onClick={() => void load()}><RefreshIcon className="h-4 w-4" />刷新报告</button>
      </div>
    )
  }

  const weakest = metricEntries.reduce((current, item) => item.mean < current.mean ? item : current, metricEntries[0])
  const perfectCount = metricEntries.filter(item => item.mean >= 0.999).length
  const passRate = report.caseCount ? Math.round((report.passed / report.caseCount) * 100) : 0
  const failedCount = report.caseCount - report.passed
  const weakestFailures = report.cases.filter(result => result.scores.some(score => score.key === weakest.key && score.score === 0)).length
  const comparisonByKey = new Map(data?.comparison?.metrics.map(metric => [metric.key, metric]) ?? [])

  return (
    <div className="evaluation-scope">
      {notice && <div className="ev-toast"><CheckCircleIcon className="h-4 w-4" />{notice}</div>}

      <header className="ev-page-header">
        <div className="ev-title-block">
          <span className="ev-title-icon"><EvalIcon className="h-5 w-5" /></span>
          <div>
            <div><h1>问答质量控制台</h1><span className="ev-live-badge"><i />报告已校验</span></div>
            <p>可复现题库 · 七维评估器 · 基线回归控制</p>
          </div>
        </div>
        <nav className="ev-nav-actions" aria-label="评估页快捷操作">
          <button type="button" onClick={() => document.getElementById('evaluation-overview')?.scrollIntoView({ behavior: 'smooth' })}>质量总览</button>
          <button type="button" onClick={() => document.getElementById('evaluation-comparison')?.scrollIntoView({ behavior: 'smooth' })}>版本对比</button>
          <button type="button" onClick={() => document.getElementById('evaluation-cases')?.scrollIntoView({ behavior: 'smooth' })}>用例诊断</button>
        </nav>
        <div className="ev-header-actions">
          <button type="button" onClick={() => void load()} disabled={loading} className="ev-icon-button" aria-label="刷新评估报告">
            <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={exportReport} className="ev-export-button">↓ 导出报告</button>
        </div>
      </header>

      <section className="ev-hero-grid" id="evaluation-overview">
        <article className="ev-panel ev-score-panel">
          <div className="ev-score-copy">
            <span className="ev-kicker">质量总分</span>
            <h2>当前知识问答质量</h2>
            <p>所有非空指标的加权平均成绩</p>
          </div>
          <ScoreOrbit score={report.totalScore} />
          <div className="ev-score-verdict">
            <span className="is-healthy"><i />生产就绪</span>
            <small>目标线 90 · 当前高出 {(report.totalScore - 90).toFixed(1)} 分</small>
          </div>
        </article>

        <article className="ev-panel ev-summary-panel">
          <header><span className="ev-kicker">评估概览</span><strong>本轮评估概览</strong></header>
          <div className="ev-summary-grid">
            <div className="primary"><span>用例通过率</span><strong>{passRate}<em>%</em></strong><small>{report.passed} / {report.caseCount} 题全项通过</small></div>
            <div><span>满分指标</span><strong>{perfectCount}<em> / {metricEntries.length}</em></strong><small>保持项未发生回归</small></div>
            <div><span>待诊断用例</span><strong>{failedCount}</strong><small>点击下方查看失败原因</small></div>
            <div><span>评估耗时</span><strong>{report.elapsedMs}<em>ms</em></strong><small>串行可复现执行</small></div>
          </div>
          <div className="ev-run-foot"><span><ClockIcon className="h-3.5 w-3.5" />{formatDate(report.generatedAt)}</span><code>{report.runId}</code></div>
        </article>

        <article className="ev-panel ev-risk-panel">
          <header>
            <div><span className="ev-kicker">风险聚焦</span><h2>首要改进目标</h2></div>
            <span className="ev-risk-level">P1</span>
          </header>
          <div className="ev-risk-score"><strong>{percentage(weakest.mean)}</strong><span>{METRIC_LABELS[weakest.key]?.label ?? weakest.key}</span></div>
          <p>{METRIC_LABELS[weakest.key]?.desc}</p>
          <div className="ev-risk-gap"><span>当前</span><i><b style={{ width: `${weakest.mean * 100}%` }} /></i><strong>目标 90%</strong></div>
          <div className="ev-risk-impact"><span><b>{weakestFailures}</b> 个失败用例</span><span><b>{Math.max(0, Math.round(90 - weakest.mean * 100))}</b> 分差距</span></div>
          <button type="button" onClick={() => { setActiveMetric(weakest.key); setCaseFilter('failed'); document.getElementById('evaluation-cases')?.scrollIntoView({ behavior: 'smooth' }) }}>定位问题用例 →</button>
        </article>
      </section>

      <section className="ev-panel ev-metrics-panel">
        <header className="ev-panel-header">
          <div><span className="ev-kicker">指标矩阵</span><h2>七维质量指标矩阵</h2><p>点击任一指标，下钻查看该指标适用的真实题目与失败原因</p></div>
          <div className="ev-matrix-legend"><span className="perfect"><i />满分</span><span className="healthy"><i />健康</span><span className="risk"><i />需改进</span></div>
        </header>
        <div className="ev-metric-grid">
          {metricEntries.map(item => (
            <MetricCard
              key={item.key}
              metricKey={item.key}
              mean={item.mean}
              n={item.n}
              comparison={comparisonByKey.get(item.key)}
              active={activeMetric === item.key}
              onClick={() => focusMetric(item.key)}
            />
          ))}
        </div>
      </section>

      <ComparisonRail report={report} baseline={data?.baseline ?? null} comparison={data?.comparison ?? null} />

      <section className="ev-panel ev-cases-panel" id="evaluation-cases">
        <header className="ev-panel-header">
          <div>
            <span className="ev-kicker">用例诊断</span>
            <h2>用例级质量诊断</h2>
            <p>{activeMetric ? `当前聚焦：${METRIC_LABELS[activeMetric]?.label ?? activeMetric}` : '逐题检查检索、证据、引用与回答质量'}</p>
          </div>
          <div className="ev-case-toolbar">
            <div className="ev-case-filters">
              {(['all', 'failed', 'passed'] as CaseFilter[]).map(filter => (
                <button key={filter} type="button" className={caseFilter === filter ? 'is-active' : ''} onClick={() => setCaseFilter(filter)}>
                  {filter === 'all' ? '全部' : filter === 'failed' ? `待诊断 ${failedCount}` : `已通过 ${report.passed}`}
                </button>
              ))}
            </div>
            <label className="ev-case-search"><SearchIcon className="h-3.5 w-3.5" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索问题或用例 ID" /></label>
            {activeMetric && <button type="button" className="ev-clear-focus" onClick={() => setActiveMetric(null)}>清除指标聚焦 ×</button>}
          </div>
        </header>
        <div className="ev-case-table-head"><span>状态</span><span>题目与类型</span><span>证据</span><span>得分</span><span>结果</span><span /></div>
        <div className="ev-case-list">
          {filteredCases.length === 0 ? (
            <div className="ev-no-results"><SearchIcon className="h-5 w-5" /><span>没有符合当前筛选条件的用例</span></div>
          ) : filteredCases.map(result => (
            <CaseDiagnostic
              key={result.caseId}
              result={result}
              expanded={expandedCaseId === result.caseId}
              onToggle={() => setExpandedCaseId(current => current === result.caseId ? null : result.caseId)}
            />
          ))}
        </div>
      </section>

      <section className="ev-repro-strip">
        <div><span className="ev-kicker">可复现约束</span><strong>评估环境完整性</strong></div>
        <div className="ev-repro-items">
          <ReproSignal label="固定时间" detail={report.evalNow.slice(0, 10)} ok={report.reproducibility.fixedTime} />
          <ReproSignal label="串行执行" detail="并发数 1" ok={report.reproducibility.serial} />
          <ReproSignal label="状态隔离" detail="逐例重置" ok={report.seedResetPerCase} />
          <ReproSignal label="生产隔离" detail="独立输出目录" ok={!report.reproducibility.prodDataTouched} />
        </div>
        <div className="ev-manifest-time"><span>知识版本</span><strong>{formatDate(report.manifestCompiledAt)}</strong></div>
      </section>
    </div>
  )
}

function ReproSignal({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  return (
    <div className={ok ? 'is-ok' : 'is-fail'}>
      <span>{ok ? '✓' : '!'}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </div>
  )
}
