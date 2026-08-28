'use client'

import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import type {
  WikiListResponse,
  WikiPageDetail,
  WikiPageType,
  WikiTypeFilter,
} from '@llmwiki/contracts'
import {
  DOCUMENT_TOPIC_LABELS,
  WIKI_PAGE_TYPE_LABELS,
} from '@llmwiki/contracts'
import { PageHeader } from './PageHeader'
import { fetchWikiList, fetchWikiPage, recompileWiki } from '../lib/api'
import { formatDate } from './docMeta'
import {
  SearchIcon,
  RefreshIcon,
  SpinnerIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  LayersIcon,
  WikiIcon,
  GraphIcon,
  ClockIcon,
} from './Icons'

const TYPE_STYLE: Record<WikiPageType, string> = {
  concept: 'bg-indigo-500/10 text-indigo-300 ring-indigo-400/20',
  system: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
  playbook: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  policy: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
}

const TYPE_FILTERS: { value: WikiTypeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'concept', label: '概念' },
  { value: 'system', label: '系统' },
  { value: 'playbook', label: '手册' },
  { value: 'policy', label: '策略' },
]

type StatKey = 'pages' | 'sourceCitations' | 'interlinks' | 'topicsCovered'

const STAT_CARDS: {
  key: StatKey
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClass: string
}[] = [
  { key: 'pages', label: '知识页', icon: WikiIcon, iconClass: 'from-emerald-500/20 to-teal-500/10 text-emerald-300' },
  { key: 'sourceCitations', label: '来源引用', icon: LayersIcon, iconClass: 'from-sky-500/20 to-indigo-500/10 text-sky-300' },
  { key: 'interlinks', label: '互链', icon: GraphIcon, iconClass: 'from-emerald-500/20 to-teal-500/10 text-emerald-300' },
  { key: 'topicsCovered', label: '覆盖主题', icon: ClockIcon, iconClass: 'from-amber-500/20 to-orange-500/10 text-amber-300' },
]

function TypeBadge({ type }: { type: WikiPageType }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${TYPE_STYLE[type]}`}
    >
      {WIKI_PAGE_TYPE_LABELS[type]}
    </span>
  )
}

type LoadState = 'loading' | 'ready' | 'error'
const VIEWED_WIKI_KEY = 'llmwiki:viewed-dynamic-pages'

export function WikiView() {
  const [list, setList] = useState<WikiListResponse | null>(null)
  const [detail, setDetail] = useState<WikiPageDetail | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<WikiTypeFilter>('all')
  const [listState, setListState] = useState<LoadState>('loading')
  const [detailState, setDetailState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [recompiling, setRecompiling] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [viewedPages, setViewedPages] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(VIEWED_WIKI_KEY) ?? '[]') as string[]
      setViewedPages(new Set(stored))
    } catch {
      setViewedPages(new Set())
    }
  }, [])

  const markViewed = useCallback((slug: string) => {
    setViewedPages((current) => {
      if (current.has(slug)) return current
      const next = new Set(current)
      next.add(slug)
      localStorage.setItem(VIEWED_WIKI_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const selectPage = useCallback((slug: string, isDynamic?: boolean) => {
    setSelectedSlug(slug)
    if (isDynamic) markViewed(slug)
  }, [markViewed])

  const showNotice = useCallback((kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text })
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(t)
  }, [notice])

  const loadList = useCallback(async () => {
    setListState('loading')
    setError(null)
    try {
      const res = await fetchWikiList({ search, type })
      setList(res)
      setSelectedSlug((cur) => {
        if (cur && res.pages.some(p => p.slug === cur)) return cur
        return res.pages[0]?.slug ?? null
      })
      setListState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wiki 加载失败')
      setListState('error')
    }
  }, [search, type])

  const loadDetail = useCallback(async (slug: string) => {
    setDetailState('loading')
    try {
      const page = await fetchWikiPage(slug)
      setDetail(page)
      setDetailState('ready')
    } catch (e) {
      setDetailState('error')
      setError(e instanceof Error ? e.message : '页面加载失败')
    }
  }, [])

  // 支持从知识图谱「打开 Wiki」跳转：/wiki?slug=<slug>
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('slug')
    if (slug) {
      setSelectedSlug(slug)
      markViewed(slug)
    }
  }, [markViewed])

  useEffect(() => {
    const t = setTimeout(() => void loadList(), search.trim() ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadList, search])

  useEffect(() => {
    if (selectedSlug) void loadDetail(selectedSlug)
  }, [selectedSlug, loadDetail])

  const onRecompile = async () => {
    setRecompiling(true)
    try {
      const res = await recompileWiki()
      showNotice('success', `${res.message}，最近编译时间已刷新`)
      await loadList()
    } catch {
      showNotice('error', '重新编译失败，请稍后重试')
    } finally {
      setRecompiling(false)
    }
  }

  const badge =
    listState === 'ready' ? '知识编译 · 已就绪' : listState === 'error' ? '连接异常' : '加载中'

  const stats = list?.stats
  const sources = list?.sources ?? []
  const pages = list?.pages ?? []

  return (
    <div className="flex min-h-[calc(100dvh-5.3125rem)] flex-col gap-3 xl:h-[calc(100dvh-5.25rem)] xl:min-h-0">
      <PageHeader
        title="Wiki 知识库"
        description="把零散资料编译成可读、可互链、可追溯的知识页面"
        badge={badge}
      />

      {notice && (
        <div
          className={`fixed right-5 top-20 z-50 flex max-w-md items-center gap-2.5 rounded-xl border px-4 py-3 text-[15px] shadow-2xl backdrop-blur-xl ${
            notice.kind === 'success'
              ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-400/20 bg-rose-500/10 text-rose-200'
          }`}
        >
          {notice.kind === 'success' ? (
            <CheckCircleIcon className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* 顶部 4 统计卡（数字全部来自 API 编译口径） */}
      <section className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {STAT_CARDS.map((card, index) => {
          const Icon = card.icon
          const value = stats ? stats[card.key] : 0
          return (
            <div
              key={card.key}
              className="panel-highlight animate-fade-in-up rounded-2xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-md transition-colors hover:border-indigo-400/40 hover:bg-white/[0.06]"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br ${card.iconClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-semibold tabular-nums tracking-tight text-white">
                    {value.toLocaleString('zh-CN')}
                  </div>
                  <div className="text-[13px] text-slate-400">{card.label}</div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {/* 主区域：左侧导航 + 右侧正文 */}
      <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* 左侧：搜索 / 类型筛选 / 目录 / 来源数 */}
        <aside className="panel-highlight flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索标题或摘要"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-[15px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/30"
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setType(f.value)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  type === f.value
                    ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-inset ring-emerald-400/30'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-slate-300">知识页目录</span>
            <span className="text-[13px] tabular-nums text-slate-500">{list?.total ?? 0} 页</span>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {listState === 'loading' && pages.length === 0 ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-white/[0.06]" />
                ))}
              </div>
            ) : pages.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-slate-500">没有匹配的知识页</div>
            ) : (
              pages.map(p => (
                <button
                  key={p.slug}
                  onClick={() => selectPage(p.slug, p.isDynamic)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[15px] transition-colors ${
                    selectedSlug === p.slug
                      ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-inset ring-emerald-400/30'
                      : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {p.isDynamic && !viewedPages.has(p.slug) && (
                      <span className="shrink-0 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-950">NEW</span>
                    )}
                    <span className="truncate">{p.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <TypeBadge type={p.type} />
                    <span className="text-[12px] tabular-nums text-slate-500">{p.sourceCount} 源</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="mt-3 border-t border-white/5 pt-3">
            <div className="flex items-center justify-between text-[13px] text-slate-400">
              <span className="font-medium text-slate-300">源资料</span>
              <span className="tabular-nums text-slate-500">{sources.length} 份</span>
            </div>
            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
              {sources.map(s => (
                <div key={s.path} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate text-slate-500" title={s.path}>
                    {s.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-600">{s.pageCount} 页</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* 右侧：详情 */}
        <div className="panel-highlight min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md sm:p-6">
          {detailState === 'error' && !detail ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircleIcon className="h-10 w-10 text-rose-400" />
              <p className="mt-4 text-[15px] text-slate-300">页面加载失败</p>
              <p className="mt-1 text-[13px] text-slate-500">{error}</p>
            </div>
          ) : detailState === 'loading' && !detail ? (
            <div className="space-y-4 py-6">
              <div className="h-7 w-2/3 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-32 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ) : detail ? (
            <div className="space-y-7">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={detail.type} />
                  {detail.isDynamic && (
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2 py-0.5 text-[13px] text-amber-200">资料中心新增</span>
                  )}
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[13px] text-slate-300">
                    {DOCUMENT_TOPIC_LABELS[detail.topic]}
                  </span>
                </div>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                  {detail.title}
                </h3>
                <p className="mt-2 border-l-2 border-indigo-400/40 pl-3 text-[15px] leading-relaxed text-slate-300">
                  {detail.summary}
                </p>
              </div>

              <div>
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  知识要点
                </h4>
                <div className="space-y-3">
                  {detail.conclusion.map((c, i) => (
                    <p key={i} className="text-[15px] leading-relaxed text-slate-200">
                      {c}
                    </p>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  来源证据（{detail.sourceEvidence.length}）
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.sourceEvidence.map(ev => (
                    <div
                      key={ev.source}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[15px] font-medium text-slate-100">{ev.title}</span>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[12px] text-slate-400">
                          {DOCUMENT_TOPIC_LABELS[ev.topic]}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-slate-500">
                        来源：{ev.department || '企业资料中心'} · 内容可追溯
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {ev.points.map((pt, i) => (
                          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-400">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-indigo-400/60" />
                            {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  相关页面（{detail.links.length}）
                </h4>
                <div className="flex flex-wrap gap-2">
                  {detail.links.map(l => (
                    <button
                      key={l.slug}
                      onClick={() => selectPage(l.slug, pages.find(page => page.slug === l.slug)?.isDynamic)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-[13px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
                    >
                      {l.title}
                      <span className="text-[12px] text-indigo-300/60">
                        {WIKI_PAGE_TYPE_LABELS[l.type]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/5 pt-4">
                <span className="text-[13px] text-slate-500">
                  更新时间 {formatDate(detail.updated)}
                </span>
                <button
                  onClick={() => void onRecompile()}
                  disabled={recompiling}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-600 px-3.5 py-2 text-[15px] font-medium text-white shadow-lg shadow-emerald-700/20 transition-colors hover:from-emerald-600 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recompiling ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshIcon className="h-4 w-4" />
                  )}
                  重新编译
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
