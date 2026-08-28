export function PageHeader({
  title,
  description,
  badge,
}: {
  title: string
  description: string
  badge?: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="qa-ink text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="qa-dim mt-1 text-[15px]">{description}</p>
      </div>
      {badge && (
        <span className="qa-chip rounded-full px-3 py-1 text-[13px]">{badge}</span>
      )}
    </div>
  )
}
