/** Pure ownership check for renderer-to-Desktop IPC requests. */

/** Minimal invoke identity projected from Electron for deterministic tests. */
export interface DesktopInvokeIdentity {
  readonly senderId: number
  readonly senderFrameUrl: string | undefined
}

/** Current Desktop renderer authority. */
export interface DesktopRendererOwner {
  readonly webContentsId: number
  readonly origin: string | undefined
}

/** Reject stale Host generations, unrelated WebContents, and malformed frame URLs. */
export function assertDesktopRequestOwner(identity: DesktopInvokeIdentity, owner: DesktopRendererOwner): void {
  if (owner.origin === undefined || identity.senderId !== owner.webContentsId || identity.senderFrameUrl === undefined) {
    throw new Error('Desktop bridge request is not owned by the current renderer')
  }
  let origin: string
  try { origin = new URL(identity.senderFrameUrl).origin } catch {
    throw new Error('Desktop bridge request has an invalid renderer URL')
  }
  if (origin !== owner.origin) throw new Error('Desktop bridge request origin is not current')
}
