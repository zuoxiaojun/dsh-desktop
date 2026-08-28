import Link from 'next/link'
import {
  ChevronRightIcon,
  DocumentIcon,
  EvalIcon,
  GraphIcon,
  QaIcon,
  WikiIcon,
} from './Icons'

const SERVICES = [
  { href: '/documents', label: '文档中心', detail: '管理 128 份资料', icon: DocumentIcon, tone: 'ready' },
  { href: '/wiki', label: '知识库', detail: '浏览 47 个知识页', icon: WikiIcon, tone: 'ready' },
  { href: '/knowledge-graph', label: '知识图谱', detail: '探索 75 个节点', icon: GraphIcon, tone: 'active' },
  { href: '/ask', label: '问答中心', detail: '可溯源智能问答', icon: QaIcon, tone: 'pending' },
  { href: '/evaluation', label: '评估中心', detail: '质量总分 93.4', icon: EvalIcon, tone: 'ready' },
] as const

export function DashboardServiceLinks() {
  return (
    <section className="dashboard-panel flex h-full min-h-[290px] flex-col p-3">
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold text-slate-100">输出与服务</h2>
        <p className="mt-0.5 text-[13px] text-slate-600">进入已经生成的知识能力</p>
      </div>

      <nav className="grid min-h-0 flex-1 grid-rows-5 gap-1.5">
        {SERVICES.map((service) => {
          const Icon = service.icon
          const active = service.tone === 'active'
          const pending = service.tone === 'pending'
          return (
            <Link
              key={service.href}
              href={service.href}
              className={`group flex min-h-0 items-center gap-3 rounded-xl border px-3 py-1 transition-all ${
                active
                  ? 'border-amber-300/18 bg-amber-300/[0.045] hover:border-amber-300/30'
                  : 'border-white/[0.075] bg-white/[0.018] hover:border-emerald-300/20 hover:bg-white/[0.032]'
              }`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                active
                  ? 'border-amber-300/20 bg-amber-300/[0.06] text-amber-200'
                  : pending
                    ? 'border-white/10 bg-white/[0.025] text-slate-500'
                    : 'border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-200/80'
              }`}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-slate-200">{service.label}</span>
                  {pending && (
                    <span className="rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[11px] text-slate-600">
                      待就绪
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-slate-600">{service.detail}</div>
              </div>
              <ChevronRightIcon className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" />
            </Link>
          )
        })}
      </nav>
    </section>
  )
}
