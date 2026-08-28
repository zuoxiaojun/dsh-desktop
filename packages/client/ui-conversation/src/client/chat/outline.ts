import type {
  ContentBlock, HistoryEntry, IApiClient, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

const HISTORY_PAGE_MESSAGES = 50
/** Product limit for one directory preview, including a possible ellipsis. */
export const OUTLINE_SUMMARY_MAX_CHARS = 80

/** The three transcript roles represented in the conversation outline. */
export type ConversationOutlineRole = 'user' | 'assistant' | 'tool'

/** One lightweight, stable jump target in a session's complete history. */
export interface ConversationOutlineEntry {
  /** Event/node sequence used by ChatView's rendered anchor. */
  readonly seq: number
  /** Role color and accessible label. */
  readonly role: ConversationOutlineRole
  /** Single-line preview, already bounded to the product limit. */
  readonly summary: string
}

type OutlineApi = Pick<IApiClient, 'sessions' | 'subagents'>

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return
  throw signal.reason ?? new Error('conversation outline request aborted')
}

/**
 * Normalize arbitrary message text into one compact navigation label.
 * @param text - raw message or Tool label.
 * @returns a whitespace-normalized preview of at most 80 characters.
 */
export function outlineSummary(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= OUTLINE_SUMMARY_MAX_CHARS) return normalized
  return `${normalized.slice(0, OUTLINE_SUMMARY_MAX_CHARS - 1)}…`
}

function contentSummary(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  let images = 0
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') {
      if (block.text.trim() !== '') parts.push(block.text)
    } else if (block.type === 'image') {
      images += 1
    }
  }
  if (images > 0) parts.push(images === 1 ? 'Image' : `${images} images`)
  return outlineSummary(parts.join(' '))
}

function assistantSummary(blocks: readonly AssistantBlock[]): string {
  const parts: string[] = []
  let images = 0
  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'reasoning') {
      if (block.text.trim() !== '') parts.push(block.text)
    } else if (block.kind === 'image') {
      images += 1
    }
  }
  if (images > 0) parts.push(images === 1 ? 'Image' : `${images} images`)
  return outlineSummary(parts.join(' '))
}

/**
 * Translate raw history rows into the outline's visible roles only.
 * @param entries - one history page in ascending event order.
 * @returns navigation entries represented by that page.
 */
export function outlineEntriesFromHistory(entries: readonly HistoryEntry[]): ConversationOutlineEntry[] {
  const outline: ConversationOutlineEntry[] = []
  for (const { event } of entries) {
    if (event.type === 'tool/call') {
      const name = event.data.name.trim() || String(event.data.callId)
      outline.push({ seq: event.seq, role: 'tool', summary: outlineSummary(name) })
      continue
    }
    if (event.type === 'user/message'
      && event.surfaceOp === 'append'
      && event.data.source.kind === 'user') {
      outline.push({ seq: event.seq, role: 'user', summary: contentSummary(event.data.content) })
      continue
    }
    if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      const summary = contentSummary(event.data.message.content)
      // Tool-only assistant messages have no Assistant row; their tool/call
      // events are represented independently above.
      if (summary !== '') outline.push({ seq: event.seq, role: 'assistant', summary })
    }
  }
  return outline
}

/**
 * Read a session's complete lightweight outline without extending the
 * transcript's rendered history window.
 * @param api - shared history API client.
 * @param sessionId - ordinary or addressed child session identity.
 * @param address - retained subagent route, when the session is addressed.
 * @param signal - cancellation for a superseded session view.
 * @returns every visible navigation entry in ascending sequence order.
 */
export async function readConversationOutline(
  api: OutlineApi,
  sessionId: SessionId,
  address: SubagentAddress | undefined,
  signal?: AbortSignal,
): Promise<ConversationOutlineEntry[]> {
  const bySeq = new Map<number, ConversationOutlineEntry>()
  let beforeSeq: number | undefined
  while (true) {
    throwIfAborted(signal)
    const requestPage = beforeSeq === undefined
      ? { maxMessages: HISTORY_PAGE_MESSAGES }
      : { beforeSeq, maxMessages: HISTORY_PAGE_MESSAGES }
    const response = address === undefined
      ? await api.sessions.history({ sessionId, ...requestPage }, signal)
      : await api.subagents.history({ ...address, ...requestPage }, signal)
    throwIfAborted(signal)
    if (!response.result.ok) {
      throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
    }
    const page = response.result.value
    for (const entry of outlineEntriesFromHistory(page.events)) bySeq.set(entry.seq, entry)
    if (!page.hasMore) break
    const nextBefore = page.events[0]?.event.seq
    if (nextBefore === undefined || nextBefore === beforeSeq) {
      throw new Error('conversation outline history did not advance')
    }
    beforeSeq = nextBefore
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

/**
 * Derive current/live rows from the already assembled Chat window.
 * @param order - rendered Chat node keys.
 * @param nodes - current keyed Chat node reader.
 * @returns navigation entries for the assembled window.
 */
export function outlineEntriesFromChat(
  order: readonly string[],
  nodes: ChatNodeStore,
): ConversationOutlineEntry[] {
  const entries: ConversationOutlineEntry[] = []
  for (const key of order) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined) continue
    if (node.kind === 'user' || node.kind === 'steering') {
      entries.push({ seq: node.anchorSeq, role: 'user', summary: contentSummary(node.data.content) })
      continue
    }
    if (node.kind === 'assistant-step') {
      const summary = assistantSummary(node.data.blocks)
      if (summary !== '') entries.push({ seq: node.anchorSeq, role: 'assistant', summary })
      continue
    }
    if (node.kind === 'tool-call') {
      const rawName = 'kind' in node.data.root ? node.data.root.call?.name : node.data.root.name
      const name = rawName?.trim() || node.data.root.callId
      entries.push({ seq: node.anchorSeq, role: 'tool', summary: outlineSummary(name) })
    }
  }
  return entries
}

/**
 * Merge the durable index with current live rows, preferring live summaries.
 * @param durable - complete persisted history index.
 * @param live - current assembled window entries.
 * @returns one deduplicated ascending directory.
 */
export function mergeConversationOutline(
  durable: readonly ConversationOutlineEntry[],
  live: readonly ConversationOutlineEntry[],
): ConversationOutlineEntry[] {
  const bySeq = new Map(durable.map(entry => [entry.seq, entry]))
  for (const entry of live) bySeq.set(entry.seq, entry)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}
