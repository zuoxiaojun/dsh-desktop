import { describe, expect, it, vi } from 'vitest'
import { reloadWithHeldFrame } from '../src/window-reload-transition.ts'

describe('reloadWithHeldFrame', () => {
  it('keeps the previous frame mounted until the replacement renderer paints', async () => {
    const order: string[] = []

    await reloadWithHeldFrame({
      holdCurrentFrame: async () => ({ release: () => { order.push('release') } }),
      navigate: async () => { order.push('navigate') },
      waitForPaint: async () => { order.push('paint') },
    })

    expect(order).toEqual(['navigate', 'paint', 'release'])
  })

  it('does not let a capture failure block the authoritative navigation', async () => {
    const reportTransitionFailure = vi.fn()
    const navigate = vi.fn(async () => {})

    await reloadWithHeldFrame({
      holdCurrentFrame: async () => { throw new Error('capture failed') },
      navigate,
      waitForPaint: async () => {},
      reportTransitionFailure,
    })

    expect(navigate).toHaveBeenCalledOnce()
    expect(reportTransitionFailure).toHaveBeenCalledOnce()
  })

  it('releases the held frame and propagates an authoritative navigation failure', async () => {
    const release = vi.fn()

    await expect(reloadWithHeldFrame({
      holdCurrentFrame: async () => ({ release }),
      navigate: async () => { throw new Error('navigation failed') },
      waitForPaint: async () => {},
    })).rejects.toThrow('navigation failed')
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases the held frame when the optional paint wait fails', async () => {
    const release = vi.fn()
    const reportTransitionFailure = vi.fn()

    await reloadWithHeldFrame({
      holdCurrentFrame: async () => ({ release }),
      navigate: async () => {},
      waitForPaint: async () => { throw new Error('paint wait failed') },
      reportTransitionFailure,
    })

    expect(release).toHaveBeenCalledOnce()
    expect(reportTransitionFailure).toHaveBeenCalledOnce()
  })
})
