// @vitest-environment jsdom
// Keyless assembled-product acceptance for the complete-history outline. The
// FixtureApiClient owns 75 turns, while ChatView initially mounts only the
// 50-message tail; selecting turn 1 therefore exercises independent indexing,
// chained transcript pagination, row mounting, and the final jump.

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

const scrollIntoView = vi.fn()

installAssembledBootEnv({
  setup: () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    scrollIntoView.mockClear()
  },
})

it('indexes the complete fixture history and jumps to a row outside the initial window', async () => {
  mountAssembledApp()
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })

  fireEvent.click(await screen.findByRole('button', { name: 'Open conversation outline' }))
  const count = await screen.findByText(/\d+ items/)
  expect(Number.parseInt(count.textContent ?? '0', 10)).toBeGreaterThan(150)

  const oldest = await screen.findByRole('button', { name: /问题 0：fixture 历史消息/ })
  fireEvent.click(oldest)
  await waitFor(() => {
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    const mounted = [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-seq]')]
      .some(row => row.textContent?.includes('问题 0：fixture 历史消息'))
    expect(mounted).toBe(true)
  }, { timeout: 10_000 })
})
