/** Startup gate that gives an open Plugin Center journal ownership before ordinary Host boot. */

import type {
  PluginManagementAction, PluginRecoverySnapshot,
} from '@deepseek-ai/dsh-plugin-center-contracts'
import {
  PluginOperationJournalError,
  type PluginOperationJournal,
} from './operation-journal.ts'
import {
  blocksNormalPluginStartup,
  needsAutomaticPluginRecovery,
  type PluginRecoveryController,
} from './recovery-controller.ts'

export interface PluginStartupRecoveryResult {
  readonly mode: 'normal' | 'safe' | 'recovery-failed'
  readonly recovery: PluginRecoverySnapshot | null
}

/**
 * Whether recovery restored a bootable Host but could not prove exact runtime identity.
 * @param recovery - latest durable recovery projection.
 * @returns true only for the failure that may enter the restricted Plugin Center.
 */
export function isPluginSafeModeRecovery(recovery: PluginRecoverySnapshot | null): boolean {
  return recovery?.phase === 'recovery-failed'
    && recovery.recoveryReasonCode === 'runtime-verification-failed'
}

/**
 * Limit safe-mode mutations to operations that can remove runtime authority.
 * @param action - requested installed-plugin action.
 * @returns true for disable or uninstall only.
 */
export function isPluginSafeModeManagementAction(action: PluginManagementAction): boolean {
  return action === 'disable' || action === 'uninstall'
}

/** Recover an interrupted operation first, then start the normal Host only after a safe terminal state. */
export async function preparePluginCenterStartup(input: {
  readonly journal: PluginOperationJournal
  readonly recovery: PluginRecoveryController
  readonly startNormalHost: () => Promise<unknown>
  readonly startSafeHost: () => Promise<unknown>
}): Promise<PluginStartupRecoveryResult> {
  let before
  try {
    before = await input.journal.read()
  } catch (error) {
    if (!(error instanceof PluginOperationJournalError)) throw error
    return { mode: 'recovery-failed', recovery: await input.recovery.getSnapshot() }
  }
  if (needsAutomaticPluginRecovery(before)) await input.recovery.recoverOpen('internal')
  let after
  try {
    after = await input.journal.read()
  } catch (error) {
    if (!(error instanceof PluginOperationJournalError)) throw error
    return { mode: 'recovery-failed', recovery: await input.recovery.getSnapshot() }
  }
  const recovery = await input.recovery.getSnapshot()
  if (blocksNormalPluginStartup(after)) {
    if (isPluginSafeModeRecovery(recovery)) {
      try {
        await input.startSafeHost()
        return { mode: 'safe', recovery }
      } catch {
        return { mode: 'recovery-failed', recovery }
      }
    }
    return { mode: 'recovery-failed', recovery }
  }
  await input.startNormalHost()
  return { mode: 'normal', recovery }
}
