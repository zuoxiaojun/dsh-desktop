/** Keep the last rendered Desktop frame visible while the replacement Host page loads. */

/** Disposable visual frame mounted above the navigating renderer. */
export interface HeldReloadFrame {
  /** Remove the held frame without affecting the loaded page. */
  release(): void
}

/** Operations required for one best-effort held-frame reload. */
export interface WindowReloadTransitionOptions {
  /** Capture and mount the current frame, or return undefined when no frame is available. */
  readonly holdCurrentFrame: () => Promise<HeldReloadFrame | undefined>
  /** Navigate the real Desktop renderer; failures remain operation failures. */
  readonly navigate: () => Promise<void>
  /** Wait until the replacement renderer has produced a paintable frame. */
  readonly waitForPaint: () => Promise<void>
  /** Report visual-transition failures that must not roll back a completed Host mutation. */
  readonly reportTransitionFailure?: (error: unknown) => void
}

/**
 * Navigate while retaining the previous pixels until the replacement renderer paints.
 * @param options - Visual hold, authoritative navigation, paint wait, and diagnostic operations.
 * @returns When navigation completes and the held frame has been released.
 */
export async function reloadWithHeldFrame(options: WindowReloadTransitionOptions): Promise<void> {
  let held: HeldReloadFrame | undefined
  try {
    held = await options.holdCurrentFrame()
  } catch (error) {
    options.reportTransitionFailure?.(error)
  }

  try {
    await options.navigate()
    try {
      await options.waitForPaint()
    } catch (error) {
      options.reportTransitionFailure?.(error)
    }
  } finally {
    try {
      held?.release()
    } catch (error) {
      options.reportTransitionFailure?.(error)
    }
  }
}
