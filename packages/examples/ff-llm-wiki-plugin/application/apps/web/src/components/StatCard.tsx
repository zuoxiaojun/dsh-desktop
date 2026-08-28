import type { OverviewStat, StatKey } from '@llmwiki/contracts'
import { DashboardIcon, DocumentIcon, WikiIcon, GraphIcon, QaIcon } from './Icons'

function StatIcon({ k, className }: { k: StatKey; className?: string }) {
  switch (k) {
    case 'documents':
      return <DocumentIcon className={className} />
    case 'entries':
      return <WikiIcon className={className} />
    case 'relationships':
      return <GraphIcon className={className} />
    case 'todayQa':
      return <QaIcon className={className} />
    default:
      return <DashboardIcon className={className} />
  }
}

export function StatCard({
  stat,
  index,
}: {
  stat: OverviewStat
  index: number
}) {
  const positive = stat.delta >= 0

  return (
    <div
      className="panel-highlight animate-fade-in-up group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md transition-colors hover:border-indigo-400/40 hover:bg-white/[0.06]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-indigo-500/20 blur-2xl transition-colors group-hover:bg-indigo-500/30" />

      <div className="relative flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500/20 to-violet-500/10 text-indigo-300">
          <StatIcon k={stat.key} className="h-5 w-5" />
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-medium ${
            positive
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'bg-rose-500/10 text-rose-300'
          }`}
        >
          {positive ? '▲' : '▼'} {Math.abs(stat.delta)}
        </span>
      </div>

      <div className="relative mt-4">
        <div className="text-3xl font-semibold tabular-nums tracking-tight text-white">
          {stat.value.toLocaleString('zh-CN')}
        </div>
        <div className="mt-1 text-[15px] text-slate-400">{stat.label}</div>
        <div className="mt-2 text-[13px] text-slate-500">{stat.deltaLabel}</div>
      </div>
    </div>
  )
}
