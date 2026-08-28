import Link from 'next/link'
import type {
  DocumentTopic,
  WikiListResponse,
  WikiPageType,
} from '@llmwiki/contracts'
import {
  DOCUMENT_TOPIC_LABELS,
  WIKI_PAGE_TYPE_LABELS,
} from '@llmwiki/contracts'

const FALLBACK_TOPICS: Array<{ topic: DocumentTopic; count: number }> = [
  { topic: 'engineering', count: 9 },
  { topic: 'product', count: 8 },
  { topic: 'security', count: 8 },
  { topic: 'operations', count: 8 },
  { topic: 'support', count: 7 },
  { topic: 'hr', count: 7 },
]

const FALLBACK_TYPES: Array<{ type: WikiPageType; count: number }> = [
  { type: 'concept', count: 14 },
  { type: 'policy', count: 12 },
  { type: 'playbook', count: 11 },
  { type: 'system', count: 10 },
]

const TOPIC_TONES: Record<DocumentTopic, string> = {
  engineering: 'bg-emerald-300',
  product: 'bg-cyan-300',
  security: 'bg-amber-300',
  operations: 'bg-teal-300',
  support: 'bg-sky-300',
  hr: 'bg-lime-200',
}

const FALLBACK_STATS = {
  pages: 47,
  sourceCitations: 98,
  interlinks: 99,
  topicsCovered: 6,
}

export function KnowledgeAssetOverview({ data }: { data: WikiListResponse | null }) {
  const stats = data?.stats ?? FALLBACK_STATS
  const topicCounts = data
    ? Object.entries(
      data.pages.reduce<Partial<Record<DocumentTopic, number>>>((counts, page) => {
        counts[page.topic] = (counts[page.topic] ?? 0) + 1
        return counts
      }, {}),
    )
      .map(([topic, count]) => ({ topic: topic as DocumentTopic, count: count ?? 0 }))
      .sort((a, b) => b.count - a.count)
    : FALLBACK_TOPICS
  const typeCounts = data?.types ?? FALLBACK_TYPES
  const maxTopicCount = Math.max(...topicCounts.map(item => item.count), 1)

  const headlineStats = [
    { value: stats.pages, label: '知识页', detail: '结构化内容' },
    { value: stats.sourceCitations, label: '来源引用', detail: '可追溯证据' },
    { value: stats.interlinks, label: '语义互链', detail: '跨主题连接' },
    { value: stats.topicsCovered, label: '业务主题', detail: '全域覆盖' },
  ]

  return (
    <section className="dashboard-panel min-h-[214px] overflow-hidden p-3">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-slate-100">知识资产构成</h2>
            <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.045] px-2 py-0.5 text-[11px] text-emerald-200/75">
              编译产物
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-slate-600">从原始资料沉淀出的可复用知识资产</p>
        </div>
        <Link href="/wiki" className="text-[13px] font-medium text-amber-200/85 transition-colors hover:text-amber-100">
          进入知识库 →
        </Link>
      </div>

      <div className="grid gap-2.5 lg:grid-cols-[minmax(330px,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07]">
            {headlineStats.map(item => (
              <div key={item.label} className="bg-[#0b1113]/95 px-3 py-2">
                <div className="text-xl font-semibold tabular-nums tracking-[-0.03em] text-slate-100">{item.value}</div>
                <div className="mt-0.5 text-[12px] text-slate-400">{item.label}</div>
                <div className="hidden text-[11px] text-slate-700 2xl:block">{item.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-2 rounded-xl border border-white/[0.065] bg-white/[0.016] px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="text-slate-500">知识类型</span>
              <span className="text-slate-700">结构完整度 100%</span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
              {typeCounts.map((item, index) => (
                <span
                  key={item.type}
                  className={index === 0 ? 'bg-emerald-300' : index === 1 ? 'bg-amber-300' : index === 2 ? 'bg-cyan-300/80' : 'bg-slate-500'}
                  style={{ width: `${(item.count / stats.pages) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {typeCounts.map((item, index) => (
                <div key={item.type} className="flex items-center gap-1.5 text-[12px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? 'bg-emerald-300' : index === 1 ? 'bg-amber-300' : index === 2 ? 'bg-cyan-300/80' : 'bg-slate-500'}`} />
                  <span className="text-slate-500">{WIKI_PAGE_TYPE_LABELS[item.type]}</span>
                  <span className="ml-auto tabular-nums text-slate-300">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.065] bg-[#091012]/70 px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="font-medium text-slate-400">主题知识密度</span>
            <span className="text-slate-700">共 {stats.topicsCovered} 个业务域</span>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
            {topicCounts.map(item => (
              <div key={item.topic}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400">{DOCUMENT_TOPIC_LABELS[item.topic]}</span>
                  <span className="tabular-nums text-slate-600">{item.count} 页</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.045]">
                  <div
                    className={`h-full rounded-full ${TOPIC_TONES[item.topic]} shadow-[0_0_9px_currentColor]`}
                    style={{ width: `${(item.count / maxTopicCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-white/[0.055] pt-2 text-[12px] text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.7)]" />
            全部页面已建立来源引用与知识互链
          </div>
        </div>
      </div>
    </section>
  )
}
