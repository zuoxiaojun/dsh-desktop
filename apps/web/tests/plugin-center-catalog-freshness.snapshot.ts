// @vitest-environment jsdom
/** Built-bundle replay for F001/F002 discovery, exact preflight, stale fallback, and retained journeys. */

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import {
  installAssembledBootEnv,
  mountAssembledApp,
  type AssembledBootPlugin,
} from './assembled-boot.ts'

type CatalogKind = 'plugin' | 'skill-pack'
type CatalogFreshness = 'fresh' | 'stale'

interface CatalogListQuery {
  catalogKind: CatalogKind
  scope: 'public' | 'local'
  query: string
  limit: number
}

interface CatalogSummary {
  pluginId: string
  version: string
  catalogKind: CatalogKind
  scope: 'public' | 'local'
  displayName: string
  summary: string
  publisher: string
  verified: boolean
  keywords: string[]
  capabilities: Array<'host' | 'client' | 'skill'>
  icon: null
  brandColor: string
  compatibility: {
    status: 'compatible'
    reason: null
    platforms: string[]
  }
  updatedAt: string
  installed: boolean
}

interface CatalogListResult {
  etag: string
  generatedAt: string
  freshness: CatalogFreshness
  source: 'network' | 'cache'
  sections: Record<'featured' | 'popular' | 'recent', CatalogSummary[]>
}

interface CatalogDetailResult {
  etag: string
  generatedAt: string
  freshness: CatalogFreshness
  source: 'network' | 'cache'
  detail: {
    summary: CatalogSummary
    description: string
    screenshots: never[]
    permissions: string[]
    riskLevel: 'low'
    riskSummary: string
    changelog: string
    publishedAt: string
    expectedEntries: string[]
    expectedClientModules: string[]
    expectedSkillIds: string[]
    eligible: boolean
    withdrawn: boolean
  }
}

type OperationPhase =
  | 'preflight'
  | 'downloading'
  | 'verifying-artifact'
  | 'snapshotting'
  | 'stopping-host'
  | 'installing'
  | 'validating-profile'
  | 'starting-host'
  | 'reloading'
  | 'health-checking'
  | 'verifying-runtime'
  | 'committed'
  | 'failed'

interface PluginOperation {
  schemaVersion: 1
  operationId: string
  idempotencyKey: string
  profileName: 'web'
  action: 'install'
  pluginId: string
  version: string
  phase: OperationPhase
  startedAt: string
  updatedAt: string
  hostGeneration: number | null
  failureCode: 'internal' | null
}

interface RecoverySnapshot {
  schemaVersion: 1
  operationId: string
  phase: 'recovery-failed' | 'rolled-back'
  recoveryPhase: null
  operationFailureCode: 'package-mutation-failed'
  recoveryReasonCode: 'runtime-verification-failed' | null
  attempt: number
  updatedAt: string
  canRetry: boolean
  canExportDiagnostics: boolean
}

const EXTRA_PLUGINS: readonly AssembledBootPlugin[] = [
  {
    id: '@deepseek-ai/dsh-client-ui-settings-general',
    bundlePath: 'packages/client/ui-settings-general/lib/client.js',
    url: '/plugins/ui-settings-general.js',
    rev: 'fx',
    inject: [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ],
  },
  {
    id: '@deepseek-ai/dsh-client-ui-settings-plugins',
    bundlePath: 'packages/client/ui-settings-plugins/lib/client.js',
    url: '/plugins/ui-settings-plugins.js',
    rev: 'fx',
    inject: [
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-api-remotes',
    ],
  },
  {
    id: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
    bundlePath: 'packages/client/ui-settings-plugin-inventory/lib/client.js',
    url: '/plugins/ui-settings-plugin-inventory.js',
    rev: 'fx',
    inject: [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-locale',
    ],
  },
  {
    id: '@deepseek-ai/dsh-client-ui-plugin-center',
    bundlePath: 'packages/client/ui-plugin-center/lib/client.js',
    url: '/plugins/ui-plugin-center.js',
    rev: 'fx',
    inject: [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-locale',
    ],
  },
]

const PLUGIN: CatalogSummary = {
  pluginId: 'fixture.workspace-tools',
  version: '1.0.0',
  catalogKind: 'plugin',
  scope: 'public',
  displayName: 'Workspace tools',
  summary: 'Reviewed workspace utilities.',
  publisher: 'Harness Fixture',
  verified: true,
  keywords: ['workspace'],
  capabilities: ['host', 'client'],
  icon: null,
  brandColor: '#5B8CFF',
  compatibility: { status: 'compatible', reason: null, platforms: ['darwin-arm64'] },
  updatedAt: '2026-08-15T04:00:00.000Z',
  installed: false,
}

const SKILL: CatalogSummary = {
  ...PLUGIN,
  pluginId: 'fixture.skill-pack',
  version: '0.2.0',
  catalogKind: 'skill-pack',
  displayName: 'Harness basics',
  summary: 'Reviewed Skill Bundle.',
  keywords: ['skill'],
  capabilities: ['skill'],
  brandColor: '#8B5CF6',
}

let currentFreshness: CatalogListResult['freshness']
let firstRefresh: PromiseWithResolvers<undefined>
let refreshCount: number
let compatibilityAllowed: boolean
let mutationsEnabled: boolean
let currentOperation: PluginOperation | null
let operationListeners: Set<(operation: PluginOperation) => void>
let installedVersion: string | null
let detailFailuresRemaining: number
let currentRecovery: RecoverySnapshot | null
let recoveryListeners: Set<(snapshot: RecoverySnapshot) => void>

function operation(phase: OperationPhase, idempotencyKey = 'install:fixture.workspace-tools:web-replay'): PluginOperation {
  return {
    schemaVersion: 1,
    operationId: 'operation-web-replay',
    idempotencyKey,
    profileName: 'web',
    action: 'install',
    pluginId: PLUGIN.pluginId,
    version: PLUGIN.version,
    phase,
    startedAt: '2026-08-15T05:00:00.000Z',
    updatedAt: phase === 'preflight' ? '2026-08-15T05:00:00.000Z' : '2026-08-15T05:00:01.000Z',
    hostGeneration: ['reloading', 'health-checking', 'verifying-runtime', 'committed'].includes(phase) ? 2 : null,
    failureCode: phase === 'failed' ? 'internal' : null,
  }
}

function publishOperation(next: PluginOperation): void {
  currentOperation = next
  for (const listener of operationListeners) listener(next)
}

function result(query: CatalogListQuery): CatalogListResult {
  const entry = query.catalogKind === 'plugin' ? PLUGIN : SKILL
  const matches = query.scope === 'public'
    && (query.query === '' || entry.displayName.toLocaleLowerCase().includes(query.query.toLocaleLowerCase()))
  const rows = matches ? [entry] : []
  return {
    etag: 'fixture-v1',
    generatedAt: '2026-08-15T04:00:00.000Z',
    freshness: currentFreshness,
    source: currentFreshness === 'fresh' ? 'network' : 'cache',
    sections: { featured: rows, popular: rows, recent: rows },
  }
}

function detail(): CatalogDetailResult {
  return {
    etag: 'fixture-v1',
    generatedAt: '2026-08-15T04:00:00.000Z',
    freshness: currentFreshness,
    source: currentFreshness === 'fresh' ? 'network' : 'cache',
    detail: {
      summary: PLUGIN,
      description: 'Complete built-bundle fixture detail.',
      screenshots: [],
      permissions: ['Reads the selected workspace.'],
      riskLevel: 'low',
      riskSummary: 'Reviewed but not sandboxed.',
      changelog: 'Initial exact version.',
      publishedAt: PLUGIN.updatedAt,
      expectedEntries: ['fixture.workspace-tools'],
      expectedClientModules: ['@fixture/client'],
      expectedSkillIds: [],
      eligible: true,
      withdrawn: false,
    },
  }
}

function compatibility() {
  const reasons = compatibilityAllowed ? [] : [
    {
      code: 'desktop-version-unsupported',
      subject: 'desktopVersion',
      actual: '0.1.0-rc.5',
      expected: '>=0.2.0',
    },
    {
      code: 'platform-unsupported',
      subject: 'darwin-arm64',
      actual: 'darwin-arm64',
      expected: 'win32-x64',
    },
  ]
  return {
    pluginId: PLUGIN.pluginId,
    version: PLUGIN.version,
    action: 'install',
    allowed: compatibilityAllowed,
    fingerprint: {
      desktopVersion: '0.1.0-rc.5',
      dshVersion: '0.1.0-rc.5',
      nodeVersion: '22.22.0',
      platform: 'darwin-arm64',
      catalogEtag: 'fixture-v1',
      catalogFreshness: currentFreshness,
      profileRevision: 7,
      installedPlugins: [],
      protectedPackageNames: ['@deepseek-ai/dsh-base'],
      protectedEntryIds: ['agent-loop'],
      activeOperation: false,
    },
    reasons,
    restartRequired: true,
    capabilities: PLUGIN.capabilities,
    riskLevel: 'low',
    riskSummary: 'Reviewed but not sandboxed.',
    executionAuthority: 'broad-application-authority',
  }
}

function installedResult() {
  const installed = currentOperation?.phase === 'committed' || installedVersion !== null
  return {
    profileName: 'web',
    profileRevision: installed ? 8 : 7,
    catalogFreshness: currentFreshness,
    items: installed ? [{
      pluginId: PLUGIN.pluginId,
      packageName: '@fixture/workspace-tools',
      version: installedVersion ?? PLUGIN.version,
      displayName: PLUGIN.displayName,
      icon: null,
      brandColor: PLUGIN.brandColor,
      catalogKind: PLUGIN.catalogKind,
      source: 'catalog',
      protected: false,
      enabled: true,
      bundleOrder: 1,
      disabledOrder: null,
      runtimeStatus: 'running',
      runtime: {
        entries: [{ entryId: 'fixture.workspace-tools', enabled: true, fiberPhase: 'active' }],
        clientModules: ['@fixture/client'],
        skillIds: [],
      },
      expectedEntries: ['fixture.workspace-tools'],
      expectedClientModules: ['@fixture/client'],
      expectedSkillIds: [],
      compatibility: 'compatible',
      compatibilityReason: null,
      update: null,
      pendingAction: null,
      supportedActions: ['disable', 'uninstall'],
      configurationEntryIds: ['fixture.workspace-tools'],
      ownedData: [],
    }] : [],
  }
}

installAssembledBootEnv({
  setup: () => {
    currentFreshness = 'fresh'
    firstRefresh = Promise.withResolvers<undefined>()
    refreshCount = 0
    compatibilityAllowed = true
    mutationsEnabled = false
    currentOperation = null
    installedVersion = null
    detailFailuresRemaining = 0
    currentRecovery = null
    recoveryListeners = new Set()
    operationListeners = new Set()
    Object.defineProperty(window, 'dshDesktop', {
      configurable: true,
      value: {
        catalog: {
          list: async (query: CatalogListQuery) => result(query),
          refresh: async (query: CatalogListQuery) => {
            refreshCount += 1
            if (refreshCount === 1) {
              await firstRefresh.promise
              currentFreshness = 'stale'
            } else {
              currentFreshness = 'fresh'
            }
            return result(query)
          },
          detail: async () => {
            if (detailFailuresRemaining > 0) {
              detailFailuresRemaining -= 1
              throw new Error('fixture registry rate limit')
            }
            return detail()
          },
          checkCompatibility: async () => compatibility(),
        },
        installedPlugins: {
          list: async () => installedResult(),
        },
        pluginOperations: {
          get mutationsEnabled() { return mutationsEnabled },
          install: async (request: { idempotencyKey: string }) => {
            const started = operation('preflight', request.idempotencyKey)
            publishOperation(started)
            return { kind: 'started', operation: started }
          },
          manage: async () => { throw new Error('management is not used by this replay') },
          getOperation: async () => currentOperation,
          onState: (listener: (operation: PluginOperation) => void) => {
            operationListeners.add(listener)
            return () => { operationListeners.delete(listener) }
          },
        },
        pluginOwnedData: {
          getOffer: async () => null,
          remove: async () => { throw new Error('owned-data removal is not used by this replay') },
          retain: async () => { throw new Error('owned-data retention is not used by this replay') },
        },
        pluginRecovery: {
          getState: async () => currentRecovery,
          retry: async () => currentRecovery,
          exportDiagnostics: async () => ({
            operationId: currentRecovery?.operationId ?? 'none',
            status: 'cancelled',
            filename: null,
            sha256: null,
            bytes: null,
          }),
          onState: (listener: (snapshot: RecoverySnapshot) => void) => {
            recoveryListeners.add(listener)
            return () => { recoveryListeners.delete(listener) }
          },
        },
      },
    })
  },
  cleanup: () => {
    delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
  },
})

it('plugin center first-level page preserves search, detail, stale cache, retry, sessions, and Settings navigation', async () => {
  mountAssembledApp(EXTRA_PLUGINS)

  const pluginEntry = await screen.findByRole('button', { name: 'Plugin Center' }, { timeout: 10_000 })
  fireEvent.click(pluginEntry)
  expect(await screen.findByRole('heading', { level: 1, name: 'Plugins' })).toBeTruthy()

  expect(await screen.findByTitle(/Catalog updated · Online catalog/)).toBeTruthy()
  expect((await screen.findAllByText('Workspace tools')).length).toBe(3)
  firstRefresh.resolve(undefined)
  expect((await screen.findAllByText(/Catalog may be stale/)).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('Workspace tools')).length).toBe(3)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => {
    expect(screen.getByTitle(/Catalog updated · Online catalog/)).toBeTruthy()
  })
  expect(refreshCount).toBe(2)

  const search = screen.getByRole('searchbox', { name: 'Search plugins' })
  fireEvent.change(search, { target: { value: 'Workspace' } })
  expect(await screen.findByRole('heading', { name: 'Search results' })).toBeTruthy()
  const opener = screen.getByRole('button', { name: 'View details：Workspace tools' })
  fireEvent.click(opener)
  expect(await screen.findByRole('heading', { name: 'Workspace tools' })).toBeTruthy()
  const details = screen.getByRole('main')
  expect(within(details).getByText('Complete built-bundle fixture detail.')).toBeTruthy()
  expect(within(details).getByText('Installation is compatible now')).toBeTruthy()
  expect(within(details).getByText(/broad application-process authority/)).toBeTruthy()
  expect(within(details).getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Back to plugin catalog' }))

  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))
  expect((await screen.findAllByText('Harness basics')).length).toBe(3)

  fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[1]!)
  await waitFor(() => {
    expect(screen.queryByRole('heading', { level: 1, name: 'Plugins' })).toBeNull()
  })

  const settings = screen.getByRole('button', { name: 'Settings' })
  fireEvent.click(settings)
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Plugins' }))
  expect(await within(dialog).findByRole('tab', { name: 'Plugin configuration' })).toBeTruthy()
  expect(within(dialog).getByRole('tab', { name: 'Plugin list' })).toBeTruthy()
})

it('plugin center assembled detail renders ordered preflight denial without exposing mutation', async () => {
  compatibilityAllowed = false
  mountAssembledApp(EXTRA_PLUGINS)

  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Center' }, { timeout: 10_000 }))
  const opener = (await screen.findAllByRole('button', { name: 'View details：Workspace tools' }))[0]!
  fireEvent.click(opener)
  expect(await screen.findByText('Installation is blocked now')).toBeTruthy()
  const reasons = screen.getByText('Denial reasons').parentElement!
  expect(within(reasons).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual([
    'Desktop version is unsupported',
    'Current platform is unsupported',
  ])
  expect(screen.getByRole('button', { name: 'Cannot install' }).hasAttribute('disabled')).toBe(true)
})

it('plugin center assembled runtime mismatch opens the installed safe-mode manager', async () => {
  mutationsEnabled = true
  installedVersion = PLUGIN.version
  currentRecovery = {
    schemaVersion: 1,
    operationId: 'recovery-safe-mode',
    phase: 'recovery-failed',
    recoveryPhase: null,
    operationFailureCode: 'package-mutation-failed',
    recoveryReasonCode: 'runtime-verification-failed',
    attempt: 14,
    updatedAt: '2026-08-24T10:26:12.578Z',
    canRetry: true,
    canExportDiagnostics: true,
  }
  mountAssembledApp(EXTRA_PLUGINS)

  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Center' }, { timeout: 10_000 }))
  expect(await screen.findByText('Plugin safe mode')).toBeTruthy()
  expect(screen.getByText('Recovery attempt 14')).toBeTruthy()
  const installedRow = document.querySelector('[data-installed-plugin="fixture.workspace-tools"]')
  expect(installedRow).not.toBeNull()
  expect(installedRow?.querySelector<HTMLButtonElement>('[data-action="disable"]')?.disabled).toBe(false)
  expect(installedRow?.querySelector<HTMLButtonElement>('[data-action="uninstall"]')?.disabled).toBe(false)
})

it('plugin center assembled detail retries a temporary registry failure in place', async () => {
  detailFailuresRemaining = 1
  mountAssembledApp(EXTRA_PLUGINS)

  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Center' }, { timeout: 10_000 }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'View details：Workspace tools' }))[0]!)
  expect(await screen.findByText(/npm service may be rate-limited/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry details' }))

  expect(await screen.findByText('Complete built-bundle fixture detail.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true)
})

it('desktop plugin install activation streams progress, commits after runtime proof, and rehydrates', async () => {
  mutationsEnabled = true
  mountAssembledApp(EXTRA_PLUGINS)

  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Center' }, { timeout: 10_000 }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'View details：Workspace tools' }))[0]!)
  const install = await screen.findByRole('button', { name: 'Install' })
  expect(install.hasAttribute('disabled')).toBe(false)
  fireEvent.click(install)
  const confirmation = await screen.findByRole('dialog', { name: 'Install plugin · Workspace tools' })
  fireEvent.click(within(confirmation).getByRole('checkbox', {
    name: 'I trust this exact version and agree to grant the runtime authority above.',
  }))
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm install' }))
  expect(await screen.findByRole('heading', { name: 'Installation progress' })).toBeTruthy()
  expect(screen.getAllByText('Compatibility preflight').length).toBeGreaterThan(0)

  publishOperation(operation('verifying-runtime', currentOperation!.idempotencyKey))
  await waitFor(() => {
    expect(screen.getAllByText('Verify Host and client capabilities').length).toBeGreaterThan(0)
  })
  publishOperation(operation('committed', currentOperation!.idempotencyKey))
  expect(await screen.findByText(
    'The plugin environment and client UI reloaded, and its declared runtime capabilities passed verification.',
  ))
    .toBeTruthy()
  expect(screen.getByRole('button', { name: 'Installed' }).hasAttribute('disabled')).toBe(true)

  fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[1]!)
  await waitFor(() => { expect(screen.queryByRole('heading', { name: 'Installation progress' })).toBeNull() })
  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Center' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'View details：Workspace tools' }))[0]!)
  expect((await screen.findByRole('button', { name: 'Installed' })).hasAttribute('disabled')).toBe(true)
})

it('assembled discovery keeps compatibility visible when another version is already installed', async () => {
  installedVersion = '0.9.0'
  mountAssembledApp(EXTRA_PLUGINS)

  fireEvent.click(await screen.findByRole('button', { name: 'Plugin Discovery' }, { timeout: 10_000 }))
  expect((await screen.findAllByRole('button', { name: 'Manage' })).length).toBeGreaterThan(0)
  const opener = (await screen.findAllByRole('heading', { name: 'Workspace tools' }))[0]?.closest('button')
  if (opener === null || opener === undefined) throw new Error('Discovery detail opener is missing')
  fireEvent.click(opener)

  expect(await screen.findByText('Installation is compatible now')).toBeTruthy()
  expect(screen.queryByText('This version is already installed and enabled. No reinstall is needed.')).toBeNull()
  expect((await screen.findAllByRole('button', { name: 'Manage' })).length).toBeGreaterThan(0)
})
