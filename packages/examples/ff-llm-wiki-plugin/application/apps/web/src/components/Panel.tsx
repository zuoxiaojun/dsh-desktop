import type { ReactNode } from 'react'

export function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={`panel-highlight rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md ${
        className ?? ''
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
