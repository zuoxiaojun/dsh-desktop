'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react'
import type {
  DocumentRecord,
  DocumentProcessingJob,
  DocumentsStatusFilter,
  DocumentsKindFilter,
  DocumentsTopicFilter,
  DocumentsStats,
  UploadDocumentResult,
  DocumentDetailResponse,
  DocumentTopic,
} from '@llmwiki/contracts'
import { DOCUMENT_TOPIC_LABELS } from '@llmwiki/contracts'
import { PageHeader } from './PageHeader'
import {
  KindBadge,
  TopicChip,
  StatusChip,
  ProgressBar,
  formatDate,
} from './docMeta'
import {
  fetchDocuments,
  fetchDocumentProcessing,
  uploadDocument,
  reprocessDocument,
  fetchDocumentDetail,
  updateDocument,
  deleteDocument,
} from '../lib/api'
import {
  SearchIcon,
  UploadIcon,
  RefreshIcon,
  CloseIcon,
  SpinnerIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  LayersIcon,
  InboxIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from './Icons'

const PAGE_SIZE = 10
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const ALLOWED_UPLOAD_EXT = ['pdf', 'docx', 'md', 'markdown', 'txt']

type StatKey = 'total' | 'ready' | 'processing' | 'queued' | 'failed'

const STAT_CARDS: {
  key: StatKey
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClass: string
  valueClass: string
}[] = [
  {
    key: 'total',
    label: '总资料数',
    icon: LayersIcon,
    iconClass: 'from-emerald-500/20 to-teal-500/10 text-emerald-300',
    valueClass: 'text-white',
  },
  {
    key: 'ready',
    label: '已完成',
    icon: CheckCircleIcon,
    iconClass: 'from-emerald-500/20 to-teal-500/10 text-emerald-300',
    valueClass: 'text-emerald-300',
  },
  {
    key: 'processing',
    label: '处理中',
    icon: SpinnerIcon,
    iconClass: 'from-sky-500/20 to-indigo-500/10 text-sky-300',
    valueClass: 'text-sky-300',
  },
  {
    key: 'queued',
    label: '待处理',
    icon: ClockIcon,
    iconClass: 'from-slate-500/20 to-slate-500/10 text-slate-300',
    valueClass: 'text-slate-300',
  },
  {
    key: 'failed',
    label: '异常',
    icon: AlertCircleIcon,
    iconClass: 'from-rose-500/20 to-rose-500/10 text-rose-300',
    valueClass: 'text-rose-300',
  },
]

const STATUS_FILTERS: { value: DocumentsStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'ready', label: '已完成' },
  { value: 'processing', label: '处理中' },
  { value: 'queued', label: '待处理' },
  { value: 'failed', label: '异常' },
]

const KIND_FILTERS: { value: DocumentsKindFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'xlsx', label: 'XLSX' },
  { value: 'md', label: 'Markdown' },
  { value: 'txt', label: 'TXT' },
]

const TOPIC_FILTERS: { value: DocumentsTopicFilter; label: string }[] = [
  { value: 'all', label: '全部主题' },
  ...Object.entries(DOCUMENT_TOPIC_LABELS).map(([value, label]) => ({
    value: value as DocumentTopic,
    label,
  })),
]

const EMPTY_STATS: DocumentsStats = {
  total: 0,
  ready: 0,
  processing: 0,
  queued: 0,
  failed: 0,
}

type LoadState = 'loading' | 'ready' | 'error'

export function DocumentsView() {
  const [items, setItems] = useState<DocumentRecord[]>([])
  const [stats, setStats] = useState<DocumentsStats>(EMPTY_STATS)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<DocumentsStatusFilter>('all')
  const [kind, setKind] = useState<DocumentsKindFilter>('all')
  const [topic, setTopic] = useState<DocumentsTopicFilter>('all')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const showNotice = useCallback((kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text })
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(t)
  }, [notice])

  const load = useCallback(
    async (query: {
      search: string
      status: DocumentsStatusFilter
      kind: DocumentsKindFilter
      topic: DocumentsTopicFilter
      page: number
    }) => {
      setLoadState('loading')
      setError(null)
      try {
        const res = await fetchDocuments({
          search: query.search,
          status: query.status,
          kind: query.kind,
          topic: query.topic,
          page: query.page,
          pageSize: PAGE_SIZE,
        })
        setItems(res.items)
        setStats(res.stats)
        setTotal(res.total)
        setPage(res.page)
        setTotalPages(res.totalPages)
        setLoadState('ready')
      } catch (e) {
        setError(e instanceof Error ? e.message : '资料加载失败')
        setLoadState('error')
      }
    },
    [],
  )

  useEffect(() => {
    const t = setTimeout(() => {
      void load({ search, status, kind, topic, page })
    }, search.trim() ? 250 : 0)
    return () => clearTimeout(t)
  }, [search, status, kind, topic, page, load])

  const onSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const onStatusChange = (value: DocumentsStatusFilter) => {
    setStatus(value)
    setPage(1)
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setKind('all')
    setTopic('all')
    setPage(1)
  }

  const onReprocess = async (doc: DocumentRecord) => {
    setReprocessingId(doc.id)
    try {
      await reprocessDocument(doc.id)
      showNotice('success', `「${doc.title}」已重新提交处理`)
      await load({ search, status, kind, topic, page })
    } catch {
      showNotice('error', '重新处理失败，请稍后重试')
    } finally {
      setReprocessingId(null)
    }
  }

  const refreshAfterImport = useCallback(() => {
    void load({ search, status, kind, topic, page })
  }, [kind, load, page, search, status, topic])

  const badge =
    loadState === 'ready'
      ? '实时数据 · API'
      : loadState === 'error'
        ? '连接异常'
        : '加载中'

  return (
    <div className="flex min-h-[calc(100dvh-5.3125rem)] flex-col gap-3 xl:h-[calc(100dvh-5.25rem)] xl:min-h-0">
      <PageHeader
        title="资料中心"
        description="统一管理企业资料，导入、查找与处理进度一目了然"
        badge={badge}
      />

      {notice && (
        <div
          className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[15px] ${
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
          <button
            onClick={() => setNotice(null)}
            className="ml-auto rounded p-0.5 text-current/70 hover:bg-white/10 hover:text-current"
            aria-label="关闭提示"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <section className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {STAT_CARDS.map((card, index) => {
          const Icon = card.icon
          return (
            <div
              key={card.key}
              className="panel-highlight animate-fade-in-up rounded-2xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-md transition-colors hover:border-indigo-400/40 hover:bg-white/[0.06]"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br ${card.iconClass}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className={`text-2xl font-semibold tabular-nums tracking-tight ${card.valueClass}`}>
                    {stats[card.key].toLocaleString('zh-CN')}
                  </div>
                  <div className="text-[13px] text-slate-400">{card.label}</div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <section className="panel-highlight flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
        <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="搜索资料名称、文件名或来源"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-[15px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/30"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => onStatusChange(f.value)}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    status === f.value
                      ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-inset ring-emerald-400/30'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as DocumentsKindFilter)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-[#0b1213] px-2.5 py-1.5 text-[13px] text-slate-300 outline-none focus:border-emerald-400/40"
              aria-label="按文件类型筛选"
            >
              {KIND_FILTERS.map(filter => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
            <select
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value as DocumentsTopicFilter)
                setPage(1)
              }}
              className="rounded-lg border border-white/10 bg-[#0b1213] px-2.5 py-1.5 text-[13px] text-slate-300 outline-none focus:border-emerald-400/40"
              aria-label="按业务主题筛选"
            >
              {TOPIC_FILTERS.map(filter => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-600 px-3.5 py-2 text-[15px] font-medium text-white shadow-lg shadow-emerald-700/20 transition-colors hover:from-emerald-600 hover:to-teal-500"
            >
              <UploadIcon className="h-4 w-4" />
              导入资料
            </button>
          </div>
        </div>

        {loadState === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <AlertCircleIcon className="h-10 w-10 text-rose-400" />
            <p className="mt-4 text-[15px] text-slate-300">资料加载失败</p>
            <p className="mt-1 text-[13px] text-slate-500">{error}</p>
            <button
              onClick={() => void load({ search, status, kind, topic, page })}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-slate-200 hover:bg-white/[0.08]"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              重新加载
            </button>
          </div>
        ) : loadState === 'loading' && items.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-hidden"><SkeletonRows /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <InboxIcon className="h-10 w-10 text-slate-600" />
            <p className="mt-4 text-[15px] text-slate-300">没有找到匹配的资料</p>
            <p className="mt-1 text-[13px] text-slate-500">换个关键词，或清空筛选条件再看看</p>
            <button
              onClick={clearFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] font-medium text-slate-200 hover:bg-white/[0.08]"
            >
              清空筛选
            </button>
          </div>
        ) : (
          <>
            <div className="-mx-2 min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[900px] text-[15px]">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 pb-3 pr-4 font-medium">资料</th>
                    <th className="px-2 pb-3 pr-4 font-medium">类型</th>
                    <th className="px-2 pb-3 pr-4 font-medium">主题</th>
                    <th className="px-2 pb-3 pr-4 font-medium">来源</th>
                    <th className="px-2 pb-3 pr-4 font-medium">大小</th>
                    <th className="px-2 pb-3 pr-4 font-medium">状态</th>
                    <th className="px-2 pb-3 pr-4 font-medium">更新时间</th>
                    <th className="px-2 pb-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-white/5 ${loadState === 'loading' ? 'opacity-50' : ''}`}>
                  {items.map(doc => (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedId(doc.id)}
                      className="cursor-pointer transition-colors hover:bg-emerald-300/[0.035]"
                    >
                      <td className="px-2 py-2 pr-4">
                        <div className="font-medium text-slate-100">{doc.title}</div>
                        <div className="mt-0.5 max-w-[280px] truncate text-[13px] text-slate-500">
                          {doc.originalName}
                        </div>
                      </td>
                      <td className="px-2 py-2 pr-4">
                        <KindBadge kind={doc.kind} />
                      </td>
                      <td className="px-2 py-2 pr-4">
                        <TopicChip topic={doc.topic} />
                      </td>
                      <td className="px-2 py-2 pr-4 text-slate-300">{doc.source}</td>
                      <td className="px-2 py-2 pr-4 tabular-nums text-slate-400">{doc.size}</td>
                      <td className="px-2 py-2 pr-4">
                        <StatusChip status={doc.status} />
                        {doc.status === 'processing' && <ProgressBar value={doc.progress} />}
                        {doc.status === 'failed' && doc.error && (
                          <div
                            className="mt-1 max-w-[200px] truncate text-[13px] text-rose-300/70"
                            title={doc.error}
                          >
                            {doc.error}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 pr-4 tabular-nums text-slate-400">
                        {formatDate(doc.updatedAt)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
                          <button
                            onClick={() => setSelectedId(doc.id)}
                            className="whitespace-nowrap rounded-lg border border-emerald-400/20 bg-emerald-500/[0.08] px-2.5 py-1.5 text-[13px] font-medium text-emerald-200 hover:bg-emerald-500/15"
                          >
                            查看
                          </button>
                          {doc.status === 'failed' && (
                            <button
                              onClick={() => void onReprocess(doc)}
                              disabled={reprocessingId === doc.id}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-400/20 bg-rose-500/10 px-2.5 py-1.5 text-[13px] font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {reprocessingId === doc.id ? (
                                <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshIcon className="h-3.5 w-3.5" />
                              )}
                              重新处理
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex shrink-0 items-center justify-between border-t border-white/5 pt-3">
              <div className="text-[13px] text-slate-500">共 {total} 条资料</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                  上一页
                </button>
                <span className="text-[13px] tabular-nums text-slate-400">
                  第 {page} / {totalPages} 页
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {modalOpen && (
        <ImportModal
          onClose={() => setModalOpen(false)}
          onImported={refreshAfterImport}
        />
      )}
      {selectedId && (
        <DocumentDetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={async (message) => {
            showNotice('success', message)
            await load({ search, status, kind, topic, page })
          }}
        />
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-12 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-14 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  )
}

function DocumentDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: (message: string) => Promise<void>
}) {
  const [detail, setDetail] = useState<DocumentDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState<DocumentTopic>('product')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchDocumentDetail(id)
      setDetail(response)
      if (response.document) {
        setTitle(response.document.title)
        setTopic(response.document.topic)
        setSource(response.document.source)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料详情加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const save = async () => {
    if (!title.trim()) {
      setError('资料名称不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await updateDocument(id, { title: title.trim(), topic, source: source.trim() })
      await onChanged(result.message)
      setEditing(false)
      await loadDetail()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料更新失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    setError(null)
    try {
      const result = await deleteDocument(id)
      await onChanged(result.message)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料删除失败')
      setDeleting(false)
    }
  }

  const document = detail?.document
  const processing = detail?.processing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <section className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-emerald-300/15 bg-[#071011] shadow-[0_24px_90px_rgba(0,0,0,.65)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-white">资料详情</h3>
              {document && <StatusChip status={document.status} />}
              {detail?.wikiPages.length ? (
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-2 py-0.5 text-[12px] text-emerald-200">
                  已同步 Wiki
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-slate-500">查看解析正文、处理轨迹与知识库关联</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="关闭">
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
              <div className="h-56 animate-pulse rounded-xl bg-white/[0.04]" />
            </div>
          ) : error && !detail ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <AlertCircleIcon className="h-9 w-9 text-rose-300" />
              <p className="mt-3 text-[15px] text-rose-200">{error}</p>
            </div>
          ) : document ? (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                  {editing ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-[12px] text-slate-500">资料名称</span>
                        <input value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[14px] text-white outline-none focus:border-emerald-300/40" />
                      </label>
                      <label>
                        <span className="mb-1 block text-[12px] text-slate-500">业务主题</span>
                        <select value={topic} onChange={event => setTopic(event.target.value as DocumentTopic)} className="w-full rounded-lg border border-white/10 bg-[#0b1213] px-3 py-2 text-[14px] text-white outline-none focus:border-emerald-300/40">
                          {TOPIC_FILTERS.filter(item => item.value !== 'all').map(item => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[12px] text-slate-500">资料来源</span>
                        <input value={source} onChange={event => setSource(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[14px] text-white outline-none focus:border-emerald-300/40" />
                      </label>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <KindBadge kind={document.kind} />
                        <TopicChip topic={document.topic} />
                        <span className="text-[13px] text-slate-500">{document.source}</span>
                      </div>
                      <h4 className="mt-3 text-xl font-semibold text-white">{document.title}</h4>
                      <p className="mt-1 text-[13px] text-slate-500">{document.originalName} · {document.size} · 更新于 {formatDate(document.updatedAt)}</p>
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-slate-300">知识库关联</span>
                    <span className="text-[12px] text-slate-500">{detail?.wikiPages.length ?? 0} 页</span>
                  </div>
                  {detail?.wikiPages.length ? (
                    <div className="mt-3 space-y-2">
                      {detail.wikiPages.map(page => (
                        <a key={page.slug} href={`/wiki?slug=${encodeURIComponent(page.slug)}`} className="flex items-center justify-between rounded-lg border border-emerald-300/15 bg-emerald-300/[0.05] px-3 py-2 text-[13px] text-emerald-100 hover:bg-emerald-300/10">
                          <span className="truncate">{page.title}</span><span className="text-emerald-300">查看 Wiki →</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
                      {document.status === 'ready' && document.origin === 'demo' ? '内置资料保留原有编译关系；新导入资料解析完成后会自动生成并关联 Wiki。' : '资料处理完成后将自动发布到 Wiki 知识库。'}
                    </p>
                  )}
                </div>
              </div>

              {processing && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[13px] font-medium text-slate-300">处理轨迹</span>
                    <span className="text-[13px] tabular-nums text-emerald-200">{processing.progress}% · {processing.chunkCount} 个分段</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {processing.stages.map((stage, index) => (
                      <div key={stage.key} className={`rounded-lg border p-2.5 ${stage.status === 'done' ? 'border-emerald-300/20 bg-emerald-300/[0.05]' : stage.status === 'failed' ? 'border-rose-300/20 bg-rose-300/[0.05]' : 'border-white/[0.07] bg-black/10'}`}>
                        <div className="text-[11px] tabular-nums text-slate-600">0{index + 1}</div>
                        <div className="mt-1 text-[13px] font-medium text-slate-200">{stage.label}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{stage.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[13px] font-medium text-slate-300">解析内容预览</span>
                    <span className="text-[12px] tabular-nums text-slate-500">{detail?.extractedText.length.toLocaleString('zh-CN') ?? 0} 字符</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-[13px] leading-6 text-slate-300">
                    {detail?.extractedText || '该资料没有独立解析正文，可通过其知识页或来源记录查看已沉淀的信息。'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[13px] font-medium text-slate-300">知识分段</span>
                    <span className="text-[12px] text-slate-500">{detail?.chunks.length ?? 0} 条</span>
                  </div>
                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {detail?.chunks.slice(0, 8).map(chunk => (
                      <div key={chunk.ordinal} className="rounded-lg border border-white/[0.06] bg-black/15 p-2.5">
                        <div className="text-[11px] text-emerald-300/70">分段 {String(chunk.ordinal + 1).padStart(2, '0')}</div>
                        <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-slate-400">{chunk.content}</p>
                      </div>
                    ))}
                    {!detail?.chunks.length && <p className="text-[13px] text-slate-500">暂无独立分段记录</p>}
                  </div>
                </div>
              </div>

              {error && <div className="rounded-lg border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-[13px] text-rose-200">{error}</div>}
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3.5">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-rose-200">确认删除资料及关联 Wiki？</span>
                <button onClick={() => void remove()} disabled={deleting} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">{deleting ? '删除中…' : '确认删除'}</button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1.5 text-[13px] text-slate-400 hover:bg-white/5">取消</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={!document} className="rounded-lg border border-rose-300/15 bg-rose-300/[0.05] px-3 py-1.5 text-[13px] text-rose-200 hover:bg-rose-300/10 disabled:opacity-40">删除资料</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-slate-300 hover:bg-white/5">取消</button>
                <button onClick={() => void save()} disabled={saving} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50">{saving ? '保存中…' : '保存并同步 Wiki'}</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} disabled={!document} className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-1.5 text-[13px] font-medium text-emerald-100 hover:bg-emerald-300/10 disabled:opacity-40">更新资料</button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadDocumentResult | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [processing, setProcessing] = useState<DocumentProcessingJob | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!processingId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const response = await fetchDocumentProcessing(processingId)
        if (cancelled) return
        setProcessing(response.job)
        setPollError(null)
        if (response.job?.status === 'ready' || response.job?.status === 'failed') {
          onImported()
          return
        }
      } catch (error) {
        if (cancelled) return
        setPollError(error instanceof Error ? error.message : '处理进度读取失败')
      }
      timer = setTimeout(() => void poll(), 420)
    }

    timer = setTimeout(() => void poll(), 280)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [processingId, onImported])

  const validate = (file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_UPLOAD_EXT.includes(ext)) {
      return '不支持的文件类型，请上传 PDF、DOCX、Markdown 或 TXT 文件'
    }
    if (file.size === 0) return '文件为空，请选择有内容的资料'
    if (file.size > MAX_UPLOAD_BYTES) return '文件过大，单文件上限为 50 MB'
    return null
  }

  const handleFile = async (file: File | undefined | null) => {
    if (!file || busy) return
    setLocalError(null)
    setResult(null)
    setProcessingId(null)
    setProcessing(null)
    setPollError(null)

    const err = validate(file)
    if (err) {
      setLocalError(err)
      return
    }

    setBusy(true)
    const res = await uploadDocument(file)
    setBusy(false)
    setResult(res)
    if (res.ok) {
      onImported()
      if (res.document && res.processing) {
        setProcessing(res.processing)
        setProcessingId(res.document.id)
      }
    }
  }

  const reset = () => {
    setResult(null)
    setProcessingId(null)
    setProcessing(null)
    setPollError(null)
    setLocalError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const resultTone = result
    ? !result.ok
      ? 'border-rose-400/20 bg-rose-500/10 text-rose-200'
      : result.duplicate
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
        : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0c14] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">导入资料</h3>
            <p className="mt-1 text-[13px] text-slate-500">
              支持 PDF、DOCX、Markdown、TXT，单文件不超过 50 MB
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            aria-label="关闭"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {!result && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void handleFile(e.dataTransfer.files?.[0])
            }}
            onClick={() => inputRef.current?.click()}
            className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
              dragOver
                ? 'border-indigo-400/60 bg-indigo-500/10'
                : 'border-white/15 bg-white/[0.02] hover:border-indigo-400/40 hover:bg-white/[0.04]'
            }`}
          >
            <InboxIcon className="h-10 w-10 text-indigo-300" />
            <p className="mt-3 text-[15px] text-slate-200">拖放文件到这里，或点击选择文件</p>
            <p className="mt-1 text-[13px] text-slate-500">一次导入一份资料，重复文件会自动识别</p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            if (inputRef.current) inputRef.current.value = ''
          }}
        />

        {localError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {localError}
          </div>
        )}

        {busy && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
            <SpinnerIcon className="h-5 w-5 animate-spin text-indigo-300" />
            <span className="text-[15px] text-slate-300">正在上传…</span>
          </div>
        )}

        {result && (
          <div className={`${processingId ? 'hidden' : 'mt-5 flex'} items-start gap-2.5 rounded-xl border px-4 py-4 text-[15px] ${resultTone}`}>
            {!result.ok ? (
              <AlertCircleIcon className="h-5 w-5 shrink-0" />
            ) : result.duplicate ? (
              <AlertCircleIcon className="h-5 w-5 shrink-0" />
            ) : (
              <CheckCircleIcon className="h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{result.message}</p>
              {result.document && (
                <p className="mt-1 text-[13px] opacity-80">
                  {result.document.originalName}
                </p>
              )}
            </div>
          </div>
        )}

        {processingId && processing && (
          <section className="mt-5 overflow-hidden rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.025]">
            <div className="border-b border-white/[0.07] px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {processing.status === 'ready' ? (
                      <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-300" />
                    ) : processing.status === 'failed' ? (
                      <AlertCircleIcon className="h-5 w-5 shrink-0 text-rose-300" />
                    ) : (
                      <SpinnerIcon className="h-5 w-5 shrink-0 animate-spin text-emerald-300" />
                    )}
                    <h4 className="truncate text-[15px] font-semibold text-slate-100">
                      {processing.status === 'ready'
                        ? '资料处理完成'
                        : processing.status === 'failed'
                          ? '资料处理失败'
                          : '正在构建知识索引'}
                    </h4>
                  </div>
                  <p className="mt-1 truncate text-[13px] text-slate-500">
                    {result?.document?.originalName}
                  </p>
                </div>
                <strong className="text-lg font-semibold tabular-nums text-emerald-200">
                  {processing.progress}%
                </strong>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${processing.status === 'failed' ? 'bg-rose-400' : 'bg-gradient-to-r from-emerald-400 to-cyan-300'}`}
                  style={{ width: `${processing.progress}%` }}
                />
              </div>
            </div>

            <ol className="px-4 py-2">
              {processing.stages.map((stage, index) => {
                const active = stage.status === 'running'
                const done = stage.status === 'done'
                const failed = stage.status === 'failed'
                return (
                  <li key={stage.key} className="relative flex gap-3 py-2.5">
                    {index < processing.stages.length - 1 && (
                      <span
                        className={`absolute left-[11px] top-8 h-[calc(100%-1rem)] w-px ${done ? 'bg-emerald-300/45' : 'bg-white/10'}`}
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-200'
                          : failed
                            ? 'border-rose-300/50 bg-rose-300/10 text-rose-200'
                            : active
                              ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-200 shadow-[0_0_14px_rgba(103,232,249,0.18)]'
                              : 'border-white/10 bg-white/[0.025] text-slate-600'
                      }`}
                    >
                      {done ? (
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                      ) : failed ? (
                        <AlertCircleIcon className="h-3.5 w-3.5" />
                      ) : active ? (
                        <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ClockIcon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-[13px] font-medium ${done || active ? 'text-slate-200' : failed ? 'text-rose-200' : 'text-slate-500'}`}>
                          {stage.label}
                        </span>
                        <span className="text-[12px] text-slate-600">
                          {done ? '已完成' : failed ? '异常' : active ? '执行中' : '等待中'}
                        </span>
                      </div>
                      <p className={`mt-0.5 text-[12px] ${failed ? 'text-rose-300/80' : 'text-slate-600'}`}>
                        {stage.message}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>

            {processing.status === 'ready' && (
              <div className="grid grid-cols-2 gap-px border-t border-white/[0.07] bg-white/[0.07]">
                <div className="bg-[#0a1112] px-4 py-3">
                  <strong className="block text-base tabular-nums text-slate-100">
                    {processing.extractedChars.toLocaleString('zh-CN')}
                  </strong>
                  <span className="text-[12px] text-slate-500">已解析字符</span>
                </div>
                <div className="bg-[#0a1112] px-4 py-3">
                  <strong className="block text-base tabular-nums text-slate-100">
                    {processing.chunkCount}
                  </strong>
                  <span className="text-[12px] text-slate-500">已入库知识分段</span>
                </div>
              </div>
            )}
          </section>
        )}

        {pollError && processing?.status !== 'ready' && processing?.status !== 'failed' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[12px] text-amber-200">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {pollError}，正在自动重试
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {processingId && processing && processing.status !== 'ready' && processing.status !== 'failed' ? (
            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[15px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08]"
            >
              转入后台
            </button>
          ) : result ? (
            <>
              <button
                onClick={reset}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[15px] font-medium text-slate-200 transition-colors hover:bg-white/[0.08]"
              >
                继续导入
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-gradient-to-r from-emerald-700 to-teal-600 px-3 py-2 text-[15px] font-medium text-white transition-colors hover:from-emerald-600 hover:to-teal-500"
              >
                完成
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[15px] font-medium text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
