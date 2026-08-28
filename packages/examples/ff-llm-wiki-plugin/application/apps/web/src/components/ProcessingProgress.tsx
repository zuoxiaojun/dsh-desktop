import type { ProcessingStage, StageStatus } from '@llmwiki/contracts'
import {
  DocumentIcon,
  GraphIcon,
  LayersIcon,
  QaIcon,
  WikiIcon,
} from './Icons'

const STATUS_STYLE: Record<StageStatus, { text: string; ring: string; glow: string }> = {
  done: {
    text: 'text-emerald-200',
    ring: 'border-emerald-300/70 bg-emerald-300/[0.07]',
    glow: 'shadow-[0_0_22px_rgba(110,231,183,0.12)]',
  },
  running: {
    text: 'text-amber-200',
    ring: 'border-amber-300/70 bg-amber-300/[0.07]',
    glow: 'shadow-[0_0_24px_rgba(252,211,77,0.14)]',
  },
  pending: {
    text: 'text-slate-500',
    ring: 'border-slate-600/70 bg-white/[0.015]',
    glow: '',
  },
  error: {
    text: 'text-rose-300',
    ring: 'border-rose-400/70 bg-rose-400/[0.07]',
    glow: 'shadow-[0_0_22px_rgba(251,113,133,0.12)]',
  },
}

function StageIcon({ id, className }: { id: string; className?: string }) {
  if (id.includes('parse')) return <DocumentIcon className={className} />
  if (id.includes('entity')) return <WikiIcon className={className} />
  if (id.includes('graph')) return <GraphIcon className={className} />
  if (id.includes('index')) return <LayersIcon className={className} />
  return <QaIcon className={className} />
}

function connectorClass(stage: ProcessingStage, next: ProcessingStage) {
  if (next.status === 'pending') {
    return 'border-t border-dashed border-slate-600/80'
  }
  if (stage.status === 'error' || next.status === 'error') {
    return 'bg-rose-400/70'
  }
  if (stage.status === 'running') {
    return 'dashboard-signal-active bg-gradient-to-r from-amber-300/80 to-amber-300/35'
  }
  return 'dashboard-signal-done bg-gradient-to-r from-emerald-300/80 to-emerald-300/40'
}

export function ProcessingProgress({
  stages,
}: {
  stages: ProcessingStage[]
}) {
  return (
    <section className="dashboard-panel overflow-hidden px-3 py-2 sm:px-5">
      <div className="mb-1 flex items-center justify-between px-2">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-100">知识构建流水线</h2>
          <p className="mt-0.5 text-[13px] text-slate-600">资料 → 条目 → 图谱 / 索引 → 问答能力</p>
        </div>
        <span className="hidden items-center gap-2 text-[13px] text-slate-500 sm:flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]" />
          2 个阶段运行中
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[840px] grid-cols-5">
          {stages.map((stage, index) => {
            const style = STATUS_STYLE[stage.status]
            const next = stages[index + 1]
            return (
              <li key={stage.id} className="relative px-4 text-center">
                {next && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-[53px] z-0 h-px ${connectorClass(stage, next)}`}
                    style={{
                      left: 'calc(50% + 30px)',
                      right: 'calc(-50% + 30px)',
                    }}
                  />
                )}
                <div className="relative z-10">
                  <div className="text-[13px] tabular-nums text-slate-600">0{index + 1}</div>
                  <div className="mt-0.5 truncate text-[13px] font-medium text-slate-200">{stage.name}</div>
                  <div className={`mx-auto mt-1.5 flex h-10 w-10 items-center justify-center rounded-full border ${style.ring} ${style.glow}`}>
                    <StageIcon id={stage.id} className={`h-5 w-5 ${style.text}`} />
                  </div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums tracking-tight ${style.text}`}>
                    {stage.progress}%
                  </div>
                  <div className="text-[12px] text-slate-500">
                    {stage.status === 'done'
                      ? '已完成'
                      : stage.status === 'running'
                        ? '进行中'
                        : stage.status === 'error'
                          ? '异常'
                          : '等待中'}
                  </div>
                  <div className="mx-auto mt-1.5 max-w-[170px] border-t border-white/[0.06] pt-1 text-[11px] text-slate-600">
                    {stage.detail}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
