import type {
  DocumentKind,
  DocumentStatus,
  DocumentTopic,
} from '@llmwiki/contracts'
import { DOCUMENT_TOPIC_LABELS } from '@llmwiki/contracts'

export const KIND_LABEL: Record<DocumentKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  md: 'MD',
  txt: 'TXT',
  html: 'HTML',
}

export const KIND_STYLE: Record<DocumentKind, string> = {
  pdf: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
  docx: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
  xlsx: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  md: 'bg-violet-500/10 text-violet-300 ring-violet-400/20',
  txt: 'bg-slate-500/10 text-slate-300 ring-slate-400/20',
  html: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
}

/** 状态徽标（面向业务用户的四种处理状态） */
export const STATUS_META: Record<
  DocumentStatus,
  { label: string; className: string; dot: string }
> = {
  ready: {
    label: '已完成',
    className: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
    dot: 'bg-emerald-400',
  },
  processing: {
    label: '处理中',
    className: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
    dot: 'bg-sky-400 animate-pulse',
  },
  queued: {
    label: '待处理',
    className: 'bg-slate-500/10 text-slate-300 ring-slate-400/20',
    dot: 'bg-slate-400',
  },
  failed: {
    label: '异常',
    className: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
    dot: 'bg-rose-400',
  },
}

/** 主题徽标（产品 / 研发 / 客服 / 安全 / 运维 / 人力） */
export const TOPIC_STYLE: Record<DocumentTopic, string> = {
  product: 'bg-indigo-500/10 text-indigo-300 ring-indigo-400/20',
  engineering: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
  support: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  security: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
  operations: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  hr: 'bg-violet-500/10 text-violet-300 ring-violet-400/20',
}

export function KindBadge({ kind }: { kind: DocumentKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${KIND_STYLE[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  )
}

export function TopicChip({ topic }: { topic: DocumentTopic }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ring-1 ring-inset ${TOPIC_STYLE[topic]}`}
    >
      {DOCUMENT_TOPIC_LABELS[topic]}
    </span>
  )
}

export function StatusChip({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset ${meta.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

/** 处理进度条（仅处理中展示） */
export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 w-24 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sky-400 transition-all duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-[13px] tabular-nums text-slate-400">{clamped}%</span>
    </div>
  )
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}
