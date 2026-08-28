import type { DocumentItem } from '@llmwiki/contracts'
import { KindBadge, STATUS_META, formatTime } from './docMeta'

export function RecentDocuments({
  items,
  className,
}: {
  items: DocumentItem[]
  className?: string
}) {
  return (
    <section className={`dashboard-panel flex h-full min-h-[290px] flex-col p-3 ${className ?? ''}`}>
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-100">最近文档</h2>
          <p className="mt-0.5 text-[13px] text-slate-600">近期进入知识流水线的企业资料</p>
        </div>
        <a
          href="/documents"
          className="text-[13px] font-medium text-amber-200/85 transition-colors hover:text-amber-100"
        >
          查看全部 →
        </a>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_72px_76px_52px] gap-3 border-b border-white/[0.06] pb-1.5 text-[12px] uppercase tracking-[0.12em] text-slate-600 sm:grid">
        <span>文档名称</span>
        <span>类型</span>
        <span>状态</span>
        <span className="text-right">时间</span>
      </div>

      <ul className="grid flex-1 grid-rows-6 divide-y divide-white/[0.055]">
        {items.map(doc => (
          <li key={doc.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_72px_76px_52px]">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-slate-200">{doc.title}</div>
              <div className="mt-0.5 text-[12px] tabular-nums text-slate-600 sm:hidden">
                {doc.size} · {formatTime(doc.updatedAt)}
              </div>
            </div>
            <KindBadge kind={doc.kind} />
            <span className="hidden items-center gap-1.5 text-[13px] text-slate-400 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[doc.status].dot}`} />
              {STATUS_META[doc.status].label}
            </span>
            <span className="hidden text-right text-[13px] tabular-nums text-slate-500 sm:block">
              {formatTime(doc.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
