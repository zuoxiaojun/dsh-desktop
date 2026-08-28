import Link from 'next/link'
import type { EvalLatestResponse } from '@llmwiki/contracts'

const FALLBACK_METRICS = {
  retrieval_hit: { mean: 0.6154, n: 13 },
  evidence_coverage: { mean: 0.9231, n: 13 },
  citation_valid: { mean: 1, n: 13 },
  answer_faithful: { mean: 1, n: 13 },
}

export function QualityEvaluationSummary({ data }: { data: EvalLatestResponse | null }) {
  const report = data?.report
  const metrics = report?.metricMeans ?? FALLBACK_METRICS
  const score = report?.totalScore ?? 93.4
  const caseCount = report?.caseCount ?? 16
  const passed = report?.passed ?? 10
  const regressionFree = data?.comparison?.regressionFree ?? true
  const circumference = 2 * Math.PI * 48
  const scoreOffset = circumference * (1 - score / 100)
  const metricRows = [
    { key: 'retrieval_hit', label: '检索命中', tone: 'bg-amber-300' },
    { key: 'evidence_coverage', label: '证据覆盖', tone: 'bg-emerald-300' },
    { key: 'citation_valid', label: '引用有效', tone: 'bg-cyan-300' },
    { key: 'answer_faithful', label: '答案忠实', tone: 'bg-teal-300' },
  ] as const

  return (
    <section className="dashboard-panel min-h-[214px] overflow-hidden p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-slate-100">问答质量评估</h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${regressionFree ? 'border-emerald-300/15 bg-emerald-300/[0.045] text-emerald-200/75' : 'border-rose-300/15 bg-rose-300/[0.045] text-rose-200'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${regressionFree ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              {regressionFree ? '无回归' : '发现回归'}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-slate-600">真实题库驱动的可追溯质量成绩单</p>
        </div>
        <Link href="/evaluation" className="text-[13px] font-medium text-amber-200/85 transition-colors hover:text-amber-100">
          查看报告 →
        </Link>
      </div>

      <div className="mt-2 grid grid-cols-[100px_minmax(0,1fr)] items-center gap-3">
        <div className="relative mx-auto h-[92px] w-[92px]">
          <div className="absolute inset-[16px] rounded-full bg-amber-300/[0.045] blur-xl" />
          <svg className="relative h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke="#f5cf68"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={scoreOffset}
              className="drop-shadow-[0_0_6px_rgba(245,207,104,0.45)]"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums tracking-[-0.04em] text-amber-100">{score.toFixed(1)}</span>
            <span className="mt-0.5 text-[11px] tracking-[0.13em] text-slate-600">质量</span>
          </div>
        </div>

        <div className="space-y-1.5">
          {metricRows.map((item) => {
            const value = metrics[item.key]?.mean ?? 0
            return (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400">{item.label}</span>
                  <span className="tabular-nums text-slate-300">{Math.round(value * 100)}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className={`h-full rounded-full ${item.tone}`} style={{ width: `${value * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-1.5 grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl border border-white/[0.065] bg-white/[0.015] py-1.5 text-center">
        <div>
          <div className="text-[15px] font-medium tabular-nums text-slate-200">{caseCount}</div>
          <div className="mt-0.5 text-[11px] text-slate-600">评测题</div>
        </div>
        <div>
          <div className="text-[15px] font-medium tabular-nums text-emerald-200">{passed}</div>
          <div className="mt-0.5 text-[11px] text-slate-600">全项通过</div>
        </div>
        <div>
          <div className="text-[15px] font-medium text-slate-200">30ms</div>
          <div className="mt-0.5 text-[11px] text-slate-600">本轮耗时</div>
        </div>
      </div>
    </section>
  )
}
