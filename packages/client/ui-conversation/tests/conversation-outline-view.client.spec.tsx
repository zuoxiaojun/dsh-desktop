// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ConversationOutline } from '../src/client/chat/ConversationOutline.tsx'
import type { ConversationOutlineEntry } from '../src/client/chat/outline.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

function entries(count: number): ConversationOutlineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    role: index % 3 === 0 ? 'user' : index % 3 === 1 ? 'assistant' : 'tool',
    summary: `entry ${index + 1}`,
  }))
}

describe('ConversationOutline', () => {
  it('keeps a large directory in a bounded DOM window and marks the current row', () => {
    const view = render(
      <ConversationOutline
        entries={entries(500)}
        activeSeq={3}
        jumpingSeq={null}
        loading={false}
        error={false}
        navigationError={false}
        expanded
        onExpandedChange={() => {}}
        onJump={() => {}}
        t={t}
      />,
    )
    expect(view.getByText('500 项')).toBeTruthy()
    // Header control plus the overscanned 336px / 48px row window; the other
    // 480+ entries remain geometry only.
    expect(view.getAllByRole('button').length).toBeLessThan(30)
    expect(view.getByRole('button', { name: /entry 3/ }).getAttribute('aria-current')).toBe('location')
    expect(view.queryByText('entry 200')).toBeNull()
  })

  it('can hide completely and leaves one explicit restore control', () => {
    const onExpandedChange = vi.fn()
    const view = render(
      <ConversationOutline
        entries={entries(2)}
        activeSeq={null}
        jumpingSeq={null}
        loading={false}
        error={false}
        navigationError={false}
        expanded
        onExpandedChange={onExpandedChange}
        onJump={() => {}}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '隐藏对话目录' }))
    expect(onExpandedChange).toHaveBeenCalledWith(false)
    expect(view.getByRole('button', { name: '显示对话目录' })).toBeTruthy()
    expect(view.queryByText('entry 1')).toBeNull()
  })

  it('stays expanded when pointer geometry changes and collapses only through its control', () => {
    const onExpandedChange = vi.fn()
    const view = render(
      <ConversationOutline
        entries={entries(2)}
        activeSeq={null}
        jumpingSeq={null}
        loading={false}
        error={false}
        navigationError={false}
        expanded
        onExpandedChange={onExpandedChange}
        onJump={() => {}}
        t={t}
      />,
    )
    fireEvent.mouseLeave(view.getByRole('complementary', { name: '对话目录' }))
    expect(onExpandedChange).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '收起对话目录' }))
    expect(onExpandedChange).toHaveBeenCalledWith(false)
  })
})
