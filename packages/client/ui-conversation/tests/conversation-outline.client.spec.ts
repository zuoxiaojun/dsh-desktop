import { describe, expect, it, vi } from 'vitest'
import type {
  HistoryEntry, IApiClient, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  mergeConversationOutline, outlineEntriesFromHistory, outlineSummary, readConversationOutline,
} from '../src/client/chat/outline.ts'

const SID = 'outline-session' as SessionId

function entry(event: unknown): HistoryEntry {
  return { event } as HistoryEntry
}

function user(seq: number, text: string, kind = 'user'): HistoryEntry {
  return entry({
    type: 'user/message', seq, time: seq, surfaceOp: 'append',
    data: { id: `u-${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind } },
  })
}

function assistant(seq: number, content: unknown[]): HistoryEntry {
  return entry({
    type: 'assistant/message', seq, time: seq, surfaceOp: 'append',
    data: {
      turn: 1, step: 1,
      message: { id: `a-${seq}`, role: 'assistant', content, source: { kind: 'model', provider: 'mock', model: 'mock' } },
    },
  })
}

function tool(seq: number, name: string): HistoryEntry {
  return entry({
    type: 'tool/call', seq, time: seq,
    data: { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: '{}' },
  })
}

function apiWithHistory(history: ReturnType<typeof vi.fn>): Pick<IApiClient, 'sessions' | 'subagents'> {
  return {
    sessions: { history } as unknown as IApiClient['sessions'],
    subagents: { history } as unknown as IApiClient['subagents'],
  }
}

describe('conversation outline index', () => {
  it('normalizes and bounds previews at 80 characters', () => {
    expect(outlineSummary('  first\n\tsecond  ')).toBe('first second')
    const summary = outlineSummary('x'.repeat(100))
    expect(summary).toHaveLength(80)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('indexes visible user, assistant, and root tool rows while excluding injected and tool-only messages', () => {
    expect(outlineEntriesFromHistory([
      user(1, 'hello'),
      user(2, 'system context', 'plugin'),
      assistant(3, [{ type: 'tool-call', id: 'c', name: 'bash', arguments: '{}' }]),
      tool(4, 'bash'),
      assistant(5, [{ type: 'reasoning', text: 'inspect first' }, { type: 'text', text: 'done' }]),
    ])).toEqual([
      { seq: 1, role: 'user', summary: 'hello' },
      { seq: 4, role: 'tool', summary: 'bash' },
      { seq: 5, role: 'assistant', summary: 'inspect first done' },
    ])
  })

  it('reads every history page without extending the transcript window', async () => {
    const history = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true, value: { events: [user(50, 'recent')], hasMore: true } } })
      .mockResolvedValueOnce({ result: { ok: true, value: { events: [tool(4, 'read'), user(5, 'older')], hasMore: false } } })
    const result = await readConversationOutline(apiWithHistory(history), SID, undefined)
    expect(result).toEqual([
      { seq: 4, role: 'tool', summary: 'read' },
      { seq: 5, role: 'user', summary: 'older' },
      { seq: 50, role: 'user', summary: 'recent' },
    ])
    expect(history).toHaveBeenNthCalledWith(1, { sessionId: SID, maxMessages: 50 }, undefined)
    expect(history).toHaveBeenNthCalledWith(2, { sessionId: SID, beforeSeq: 50, maxMessages: 50 }, undefined)
  })

  it('routes addressed sessions through subagent history and prefers live summaries', async () => {
    const history = vi.fn().mockResolvedValue({
      result: { ok: true, value: { events: [user(8, 'durable')], hasMore: false } },
    })
    const address = {
      parentSessionId: 'parent' as SessionId,
      childSessionId: SID,
      mode: 'continuable',
    } satisfies SubagentAddress
    const durable = await readConversationOutline(apiWithHistory(history), SID, address)
    expect(history).toHaveBeenCalledWith({ ...address, maxMessages: 50 }, undefined)
    expect(mergeConversationOutline(durable, [
      { seq: 8, role: 'user', summary: 'live' },
      { seq: 9, role: 'assistant', summary: 'answering' },
    ])).toEqual([
      { seq: 8, role: 'user', summary: 'live' },
      { seq: 9, role: 'assistant', summary: 'answering' },
    ])
  })
})
