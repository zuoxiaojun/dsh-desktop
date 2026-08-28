import Link from 'next/link'

const NODES = [
  { id: 'center', x: 260, y: 164, r: 32, label: '变更管理', tone: 'active', level: 0 },
  { id: 'auth', x: 142, y: 78, r: 23, label: '接口安全', tone: 'done', level: 1 },
  { id: 'release', x: 266, y: 55, r: 24, label: '发布流程', tone: 'done', level: 1 },
  { id: 'monitor', x: 391, y: 88, r: 23, label: '监控告警', tone: 'active', level: 1 },
  { id: 'backup', x: 421, y: 204, r: 23, label: '备份恢复', tone: 'done', level: 1 },
  { id: 'capacity', x: 337, y: 276, r: 22, label: '容量规划', tone: 'done', level: 1 },
  { id: 'review', x: 181, y: 275, r: 22, label: '故障复盘', tone: 'active', level: 1 },
  { id: 'risk', x: 93, y: 189, r: 22, label: '风险评审', tone: 'active', level: 1 },
  { id: 'gateway', x: 54, y: 67, r: 15, label: '网关', tone: 'signal', level: 2 },
  { id: 'permission', x: 116, y: 133, r: 16, label: '权限', tone: 'signal', level: 2 },
  { id: 'approval', x: 215, y: 103, r: 17, label: '门禁', tone: 'signal', level: 2 },
  { id: 'gray', x: 330, y: 111, r: 17, label: '灰度', tone: 'signal', level: 2 },
  { id: 'alert', x: 467, y: 119, r: 16, label: '告警', tone: 'signal', level: 2 },
  { id: 'audit', x: 474, y: 264, r: 16, label: '审计', tone: 'signal', level: 2 },
  { id: 'drill', x: 405, y: 307, r: 16, label: '演练', tone: 'signal', level: 2 },
  { id: 'quota', x: 275, y: 314, r: 16, label: '配额', tone: 'signal', level: 2 },
  { id: 'oncall', x: 101, y: 285, r: 16, label: '值班', tone: 'signal', level: 2 },
  { id: 'rollback', x: 50, y: 243, r: 17, label: '回滚', tone: 'signal', level: 2 },
] as const

const EDGES = [
  ['center', 'auth'], ['center', 'release'], ['center', 'monitor'],
  ['center', 'backup'], ['center', 'capacity'], ['center', 'review'],
  ['center', 'risk'], ['auth', 'release'], ['release', 'monitor'],
  ['monitor', 'backup'], ['backup', 'capacity'], ['capacity', 'review'],
  ['review', 'risk'], ['risk', 'auth'], ['gateway', 'auth'],
  ['gateway', 'permission'], ['permission', 'auth'], ['permission', 'approval'],
  ['approval', 'release'], ['approval', 'center'], ['release', 'gray'],
  ['gray', 'monitor'], ['gray', 'alert'], ['alert', 'monitor'],
  ['alert', 'backup'], ['backup', 'audit'], ['audit', 'drill'],
  ['drill', 'capacity'], ['capacity', 'quota'], ['quota', 'review'],
  ['review', 'oncall'], ['oncall', 'risk'], ['risk', 'rollback'],
  ['rollback', 'review'],
] as const

const byId = new Map(NODES.map(node => [node.id, node]))

export function KnowledgeGraphPreview() {
  return (
    <section className="dashboard-panel relative flex h-full min-h-[290px] flex-col overflow-hidden p-3">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/[0.035] blur-3xl" />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-100">知识图谱预览</h2>
          <p className="mt-0.5 text-[13px] text-slate-600">真实知识页与主题关系</p>
        </div>
        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.05] px-2 py-1 text-[12px] text-emerald-200/75">
          75 节点 · 291 边
        </span>
      </div>

      <div className="relative z-10 flex min-h-[220px] flex-1 items-center justify-center pb-1">
        <svg viewBox="0 0 520 330" className="h-full max-h-[400px] min-h-[220px] w-full max-w-[560px]" role="img" aria-label="知识图谱关系预览">
          <defs>
            <radialGradient id="graph-center" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.02" />
            </radialGradient>
            <filter id="graph-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {EDGES.map(([from, to]) => {
            const a = byId.get(from)
            const b = byId.get(to)
            if (!a || !b) return null
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={from === 'center' ? '#fbbf24' : '#6ee7b7'}
                strokeOpacity={from === 'center' ? 0.34 : 0.16}
                strokeWidth={from === 'center' ? 1.1 : 0.7}
              />
            )
          })}

          <ellipse cx="260" cy="164" rx="185" ry="124" fill="none" stroke="#6ee7b7" strokeWidth="0.6" strokeOpacity="0.08" strokeDasharray="3 9" />
          <ellipse cx="260" cy="164" rx="122" ry="86" fill="none" stroke="#fbbf24" strokeWidth="0.6" strokeOpacity="0.08" strokeDasharray="2 8" />

          {Array.from({ length: 42 }, (_, index) => {
            const angle = (index / 42) * Math.PI * 2
            const radius = 126 + (index % 5) * 18
            const x = 260 + Math.cos(angle) * radius
            const y = 164 + Math.sin(angle) * radius * 0.69
            return <circle key={index} cx={x} cy={y} r={index % 5 === 0 ? 3 : 2} fill="#94a3b8" opacity={0.14 + (index % 3) * 0.05} />
          })}

          {NODES.map((node) => {
            const active = node.tone === 'active'
            const center = node.id === 'center'
            const signal = node.tone === 'signal'
            return (
              <g key={node.id} filter={center ? 'url(#graph-glow)' : undefined}>
                {center && <circle cx={node.x} cy={node.y} r={50} fill="url(#graph-center)" />}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={center ? '#2b1d0c' : active ? '#19150e' : signal ? '#0a1416' : '#0d1b18'}
                  stroke={center || active ? '#fbbf24' : signal ? '#67e8f9' : '#6ee7b7'}
                  strokeOpacity={center ? 0.9 : signal ? 0.35 : 0.48}
                  strokeWidth={center ? 1.4 : signal ? 0.75 : 0.9}
                />
                {node.level === 2 && <circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="#67e8f9" strokeOpacity="0.06" strokeWidth="1" />}
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  fill={center ? '#fef3c7' : '#cbd5e1'}
                  fontSize={center ? 11 : node.level === 2 ? 7.5 : 9}
                  fontWeight={center ? 600 : 500}
                >
                  {node.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <Link href="/knowledge-graph" className="absolute bottom-3 right-3 z-20 text-[13px] font-medium text-amber-200/85 transition-colors hover:text-amber-100">
        查看图谱 →
      </Link>
    </section>
  )
}
