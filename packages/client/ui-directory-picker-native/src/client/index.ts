/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * two directory-flow holes with a renderless occupant that answers each
 * `open` by driving Electron's fixed preload operation when present, or
 * `host.pickDirectory` in an ordinary local Web deployment, and reporting
 * the one outcome — picked path, cancellation, or failure — back through the
 * owner conversation. Mounting this package composes the Host fallback and
 * client interaction with one cordis.yml row; no client code branches on a
 * capability kind.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'

/** Narrow optional face added by the sandboxed Electron preload. */
interface DesktopDirectoryPickerBridge {
  readonly workspace: {
    pickDirectory(): Promise<string | null>
  }
}

/** Prefer Electron's in-process dialog while retaining the local Web Host path. */
function pickDirectory(ctx: ClientContext): Promise<string | null> {
  const desktop = (window as unknown as { dshDesktop?: DesktopDirectoryPickerBridge }).dshDesktop
  return desktop === undefined ? ctx.workspaces.pickDirectory() : desktop.workspace.pickDirectory()
}

/** Required services (cordis fiber inject): the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces']

/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): NativeFlowInjected => ({ pick: () => pickDirectory(ctx) })
  // Both declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, NativeDirectoryFlow)
    }))
}
