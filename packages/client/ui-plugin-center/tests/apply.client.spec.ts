// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginCenterNavItem, type PluginCenterNavInjected } from '../src/client/PluginCenterNavItem.tsx'
import { PluginCenterTab, type PluginCenterTabInjected } from '../src/client/PluginCenterTab.tsx'
import { PluginDiscoveryNavItem, type PluginDiscoveryNavInjected } from '../src/client/PluginDiscoveryNavItem.tsx'
import { PluginDiscoveryPage, type PluginDiscoveryInjected } from '../src/client/PluginDiscoveryPage.tsx'
import { PresetSquareNavItem, type PresetSquareNavInjected } from '../src/client/PresetSquareNavItem.tsx'
import { PresetSquarePage, type PresetSquarePageInjected } from '../src/client/PresetSquarePage.tsx'
import { ApplicationCenterNavItem, type ApplicationCenterNavInjected } from '../src/client/ApplicationCenterNavItem.tsx'
import { ApplicationCenterPage, type ApplicationCenterInjected } from '../src/client/ApplicationCenterPage.tsx'
import { compatibilityDecision, installedListResult, listResult } from './fixtures.ts'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  delete (window as unknown as { dshDesktop?: unknown }).dshDesktop
  delete (window as unknown as { __DSH_PLUGIN_CENTER_DEV__?: unknown }).__DSH_PLUGIN_CENTER_DEV__
  window.localStorage.clear()
})

async function bench(withBridge: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  const layout = { openPrimaryPage: vi.fn(), closePrimaryPage: vi.fn() }
  const settingsNavigation = { open: vi.fn(), subscribe: vi.fn(() => () => {}) }
  const conversation = { send: vi.fn(async () => {}) }
  const agentContext = { get: vi.fn(() => conversation) }
  const sessions = {
    list: { getSnapshot: vi.fn<() => { current?: string }>(() => ({})) },
    scope: vi.fn(() => agentContext),
    noteAgentPreset: vi.fn(),
    open: vi.fn(),
  }
  const workspaces = {
    startSession: vi.fn(),
    list: { getSnapshot: vi.fn(() => ({
      items: [{ workspaceId: 'workspace-1', path: '/workspace', sessionIds: ['session-1'] }],
      recentWorkspaceId: 'workspace-1',
    })) },
    connectWorkspace: vi.fn(async () => 'session-1'),
  }
  const describeCredentials = vi.fn(async (request: { refs: string[] }) => ({
    result: { ok: true as const, value: { credentials: Object.fromEntries(request.refs.map(ref => [ref, {
      configured: false, writable: true,
    }])) } },
  }))
  const setCredential = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
  const connection = { api: {
    credentials: { describe: describeCredentials, set: setCredential },
    agentPresets: {
      list: vi.fn(async () => ({
        result: { ok: true as const, value: { presets: [], authorable: true, hasDocument: true } },
      })),
      remove: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      select: vi.fn(async (request: { agentPreset: string }) => ({
        result: { ok: true as const, value: { agentPreset: request.agentPreset } },
      })),
    },
  } }
  ctx.provide('locale', locale)
  ctx.provide('layout', layout as never)
  ctx.provide('settingsNavigation', settingsNavigation as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('connection', connection as never)
  ctx.provide('conversation', conversation as never)
  const list = vi.fn<PluginCenterTabInjected['list']>(async query => listResult(query))
  const refresh = vi.fn<PluginCenterTabInjected['refresh']>(async query => listResult(query))
  const detail = vi.fn(async () => ({
    etag: 'fixture-v1', generatedAt: '2026-08-15T04:00:00.000Z', freshness: 'fresh', source: 'network', detail: null,
  } as const))
  const checkCompatibility = vi.fn(async () => compatibilityDecision())
  const listInstalled = vi.fn(async () => installedListResult())
  const install = vi.fn(async () => { throw new Error('release gated') })
  const manage = vi.fn(async () => { throw new Error('release gated') })
  const getOperation = vi.fn(async () => null)
  const onState = vi.fn(() => () => {})
  const getOwnedDataOffer = vi.fn(async () => null)
  const removeOwnedData = vi.fn(async (request: { operationId: string; pluginId: string; paths: readonly string[] }) => ({
    operationId: request.operationId,
    pluginId: request.pluginId,
    removedPaths: request.paths,
  }))
  const retainOwnedData = vi.fn(async (request: { operationId: string; pluginId: string }) => ({
    operationId: request.operationId,
    pluginId: request.pluginId,
    retained: true as const,
  }))
  const listPresetSquare = vi.fn(async () => ({
    items: [], total: 0, sort: 'downloads' as const, fetchedAt: '2026-08-17T08:00:00.000Z',
  }))
  const detailPresetSquare = vi.fn(async () => ({ item: null, fetchedAt: '2026-08-17T08:00:00.000Z' }))
  const previewPresetInstall = vi.fn(async () => { throw new Error('not used') })
  const installPreset = vi.fn(async () => { throw new Error('not used') })
  if (withBridge) {
    Object.defineProperty(window, 'dshDesktop', {
      configurable: true,
      value: {
        catalog: { list, refresh, detail, checkCompatibility },
        installedPlugins: { list: listInstalled },
        pluginOperations: { mutationsEnabled: false, install, manage, getOperation, onState },
        pluginOwnedData: { getOffer: getOwnedDataOffer, remove: removeOwnedData, retain: retainOwnedData },
        presetSquare: {
          mutationsEnabled: true,
          list: listPresetSquare,
          detail: detailPresetSquare,
          previewInstall: previewPresetInstall,
          install: installPreset,
        },
      },
    })
  }
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, layout, settingsNavigation,
    sessions, workspaces, connection, conversation, describeCredentials, setCredential,
    list, refresh, detail, checkCompatibility, listInstalled, install, manage, getOperation, onState,
    getOwnedDataOffer, removeOwnedData, retainOwnedData,
    listPresetSquare, detailPresetSquare, previewPresetInstall, installPreset,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.primary.action': { kind: 'list', scope: 'root' },
      'main.page': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-plugin-center browser plugin', () => {
  it('registers Plugin Center, Plugin Discovery, Preset Square, and Application Center as independent pages', async () => {
    const b = await bench(true)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(inject).toEqual([
      'slots', 'layout', 'locale', 'settingsNavigation', 'sessions', 'workspaces', 'connection', 'conversation',
    ])
    const navs = b.slots.entries('sidebar.primary.action')
    const pages = b.slots.entries('main.page')
    const nav = navs.find(entry => entry.options.id === 'plugin-center')!
    const discoveryNav = navs.find(entry => entry.options.id === 'plugin-discovery')!
    const presetNav = navs.find(entry => entry.options.id === 'preset-square')!
    const applicationNav = navs.find(entry => entry.options.id === 'application-center')!
    const page = pages.find(entry => entry.options.key === 'plugin-center')!
    const discoveryPage = pages.find(entry => entry.options.key === 'plugin-discovery')!
    const presetPage = pages.find(entry => entry.options.key === 'preset-square')!
    const applicationPage = pages.find(entry => entry.options.key === 'application-center')!
    expect(nav.component).toBe(PluginCenterNavItem)
    expect(nav.options).toMatchObject({ id: 'plugin-center', order: 20 })
    expect(discoveryNav.component).toBe(PluginDiscoveryNavItem)
    expect(discoveryNav.options).toMatchObject({ id: 'plugin-discovery', order: 21 })
    expect(presetNav.component).toBe(PresetSquareNavItem)
    expect(presetNav.options).toMatchObject({ id: 'preset-square', order: 22 })
    expect(applicationNav.component).toBe(ApplicationCenterNavItem)
    expect(applicationNav.options).toMatchObject({ id: 'application-center', order: 23 })
    expect(page.component).toBe(PluginCenterTab)
    expect(page.options).toMatchObject({ key: 'plugin-center' })
    expect(discoveryPage.component).toBe(PluginDiscoveryPage)
    expect(discoveryPage.options).toMatchObject({ key: 'plugin-discovery' })
    expect(presetPage.component).toBe(PresetSquarePage)
    expect(presetPage.options).toMatchObject({ key: 'preset-square' })
    expect(applicationPage.component).toBe(ApplicationCenterPage)
    expect(applicationPage.options).toMatchObject({ key: 'application-center' })
    expect(nav.locale).toBe(NS)
    expect(discoveryNav.locale).toBe(NS)
    expect(presetNav.locale).toBe(NS)
    expect(applicationNav.locale).toBe(NS)
    expect(page.locale).toBe(NS)
    expect(discoveryPage.locale).toBe(NS)
    expect(presetPage.locale).toBe(NS)
    expect(applicationPage.locale).toBe(NS)

    const navFace = (nav.inject as unknown as () => PluginCenterNavInjected)()
    navFace.open()
    expect(b.layout.openPrimaryPage).toHaveBeenCalledWith('plugin-center')
    const discoveryNavFace = (discoveryNav.inject as unknown as () => PluginDiscoveryNavInjected)()
    discoveryNavFace.open()
    expect(b.layout.openPrimaryPage).toHaveBeenCalledWith('plugin-discovery')
    const presetNavFace = (presetNav.inject as unknown as () => PresetSquareNavInjected)()
    presetNavFace.open()
    expect(b.layout.openPrimaryPage).toHaveBeenCalledWith('preset-square')
    const applicationNavFace = (applicationNav.inject as unknown as () => ApplicationCenterNavInjected)()
    applicationNavFace.open()
    expect(b.layout.openPrimaryPage).toHaveBeenCalledWith('application-center')

    const applicationFace = (applicationPage.inject as unknown as () => ApplicationCenterInjected)()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      installed: true,
      credentialConfigured: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(applicationFace.inspectLlmWiki()).resolves.toEqual({ available: true, credentialConfigured: true })
    expect(applicationFace.getLlmWikiSidebarVisible()).toBe(false)
    const visibilityEvents: boolean[] = []
    const onVisibility = (event: Event): void => {
      visibilityEvents.push((event as CustomEvent<{ visible: boolean }>).detail.visible)
    }
    window.addEventListener('ff-llm-wiki:sidebar-visibility', onVisibility)
    applicationFace.setLlmWikiSidebarVisible(false)
    expect(window.localStorage.getItem('ff-llm-wiki:sidebar-visible')).toBe('false')
    applicationFace.setLlmWikiSidebarVisible(true)
    expect(visibilityEvents).toEqual([false, true])
    window.removeEventListener('ff-llm-wiki:sidebar-visibility', onVisibility)
    applicationFace.openModelSettings()
    expect(b.settingsNavigation.open).toHaveBeenCalledWith({ sectionId: 'models' })
    fetchSpy.mockRestore()

    const face = (page.inject as unknown as () => PluginCenterTabInjected)()
    expect(face.available).toBe(true)
    expect(face.development).toBe(false)
    expect(face.mutationsEnabled).toBe(false)
    const query = { catalogKind: 'plugin', scope: 'public', query: '', limit: 24 } as const
    await face.list(query)
    await face.refresh(query)
    await face.detail({ pluginId: 'fixture.workspace-tools', version: '1.0.0' })
    await face.checkCompatibility({ pluginId: 'fixture.workspace-tools', version: '1.0.0', action: 'install' })
    await face.listInstalled()
    face.openPluginSettings('all')
    await face.getOperation()
    await face.getOwnedDataOffer?.()
    await face.removeOwnedData({
      operationId: 'operation-1', pluginId: 'fixture.workspace-tools', paths: ['cache'], confirmation: 'remove-owned-data',
    })
    await face.retainOwnedData?.({
      operationId: 'operation-1', pluginId: 'fixture.workspace-tools', confirmation: 'retain-owned-data',
    })
    const stop = face.onOperationState(() => {})
    stop()
    expect(b.list).toHaveBeenCalledWith(query)
    expect(b.refresh).toHaveBeenCalledWith(query)
    expect(b.detail).toHaveBeenCalledWith({ pluginId: 'fixture.workspace-tools', version: '1.0.0' })
    expect(b.checkCompatibility).toHaveBeenCalledWith({
      pluginId: 'fixture.workspace-tools', version: '1.0.0', action: 'install',
    })
    expect(b.listInstalled).toHaveBeenCalledOnce()
    expect(b.settingsNavigation.open).toHaveBeenCalledWith({ sectionId: 'plugins', tabId: 'all' })
    expect(b.getOperation).toHaveBeenCalledOnce()
    expect(b.onState).toHaveBeenCalledOnce()
    expect(b.getOwnedDataOffer).toHaveBeenCalledOnce()
    expect(b.removeOwnedData).toHaveBeenCalledOnce()
    expect(b.retainOwnedData).toHaveBeenCalledOnce()
    const presetFace = (presetPage.inject as unknown as () => PresetSquarePageInjected)()
    expect(presetFace.presetAvailable).toBe(true)
    expect(presetFace.presetDevelopment).toBe(false)
    expect(presetFace.presetMutationsEnabled).toBe(true)
    await presetFace.listPresetSquare({ query: '', sort: 'downloads' })
    await presetFace.detailPresetSquare({ slug: 'fixture' })
    await presetFace.listLocalPresets()
    await presetFace.removeLocalPreset('mine')
    await presetFace.describePresetCredentials(['FEISHU_APP_ID'])
    await presetFace.setPresetCredential('FEISHU_APP_ID', 'app-id')
    await expect(presetFace.useLocalPreset('mine')).resolves.toBe('opened')
    expect(b.listPresetSquare).toHaveBeenCalledOnce()
    expect(b.detailPresetSquare).toHaveBeenCalledOnce()
    expect(b.connection.api.agentPresets.list).toHaveBeenCalledOnce()
    expect(b.connection.api.agentPresets.remove).toHaveBeenCalledWith({ agentPreset: 'mine' })
    expect(b.describeCredentials).toHaveBeenCalledWith({ refs: ['FEISHU_APP_ID'] })
    expect(b.setCredential).toHaveBeenCalledWith({ ref: 'FEISHU_APP_ID', value: 'app-id' })
    expect(b.connection.api.agentPresets.select).toHaveBeenCalledWith({ sessionId: 'session-1', agentPreset: 'mine' })
    expect(b.sessions.noteAgentPreset).toHaveBeenCalledWith('session-1', 'mine')
    expect(b.sessions.open).toHaveBeenCalledWith('session-1')
    expect(b.layout.closePrimaryPage).toHaveBeenCalledWith()

    const discoveryFace = (discoveryPage.inject as unknown as () => PluginDiscoveryInjected)()
    expect(discoveryFace.available).toBe(true)
    expect(discoveryFace.development).toBe(false)
    expect(discoveryFace.mutationsEnabled).toBe(false)
    await discoveryFace.list(query)
    await discoveryFace.refresh(query)
    await discoveryFace.detail({ pluginId: 'fixture.workspace-tools', version: '1.0.0' })
    await discoveryFace.checkCompatibility({
      pluginId: 'fixture.workspace-tools', version: '1.0.0', action: 'install',
    })
    await discoveryFace.listInstalled()
    await discoveryFace.getOperation()
    const stopDiscovery = discoveryFace.onOperationState(() => {})
    stopDiscovery()
    discoveryFace.openPluginCenter()
    expect(b.layout.openPrimaryPage).toHaveBeenLastCalledWith('plugin-center')
    await expect(discoveryFace.findWithAgent('帮我找 PDF 插件')).resolves.toBe('session-starting')
    expect(b.workspaces.startSession).toHaveBeenCalledOnce()

    b.sessions.list.getSnapshot.mockReturnValue({ current: 'session-1' })
    b.connection.api.credentials.describe.mockResolvedValue({
      result: { ok: true, value: { credentials: { DEEPSEEK_API_KEY: { configured: false, writable: true } } } },
    })
    await expect(discoveryFace.findWithAgent('帮我找 PDF 插件')).resolves.toBe('needs-model')
    expect(b.settingsNavigation.open).toHaveBeenLastCalledWith({ sectionId: 'models' })

    b.connection.api.credentials.describe.mockResolvedValue({
      result: { ok: true, value: { credentials: { DEEPSEEK_API_KEY: { configured: true, writable: true } } } },
    })
    await expect(discoveryFace.findWithAgent('帮我找 PDF 插件')).resolves.toBe('sent')
    expect(b.sessions.scope).toHaveBeenLastCalledWith('session-1')
    expect(b.conversation.send).toHaveBeenCalledWith('/find-plugins 帮我找 PDF 插件')
    expect(b.layout.closePrimaryPage).toHaveBeenLastCalledWith('plugin-discovery')
    await b.ctx.fiber.dispose()
  })

  it('survives late declaration and exposes a read-only browser absence face', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('main.page')).toHaveLength(0)
    const stop = declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('sidebar.primary.action')).toHaveLength(4)
      expect(b.slots.entries('main.page')).toHaveLength(4)
    })
    const pluginCenterPage = b.slots.entries('main.page').find(entry => entry.options.key === 'plugin-center')!
    const face = (pluginCenterPage.inject as unknown as () => PluginCenterTabInjected)()
    expect(face.available).toBe(false)
    expect(face.development).toBe(false)
    expect(face.mutationsEnabled).toBe(false)
    await expect(face.list({ catalogKind: 'plugin', scope: 'public', query: '', limit: 24 })).rejects.toThrow('unavailable')
    stop()
    expect(b.slots.entries('main.page')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('main.page')).toHaveLength(4) })
    b.locale.setLocale('en')
    await fiber.dispose()
    expect(b.slots.entries('main.page')).toHaveLength(0)
    expect(b.layout.closePrimaryPage).toHaveBeenCalledWith('plugin-center')
    expect(b.layout.closePrimaryPage).toHaveBeenCalledWith('plugin-discovery')
    expect(b.layout.closePrimaryPage).toHaveBeenCalledWith('preset-square')
    expect(b.layout.closePrimaryPage).toHaveBeenCalledWith('application-center')
    await b.ctx.fiber.dispose()
  })

  it('uses the explicit Web development fixture', async () => {
    Object.defineProperty(window, '__DSH_PLUGIN_CENTER_DEV__', {
      configurable: true,
      value: { version: 1 },
    })
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const pluginCenterPage = b.slots.entries('main.page').find(entry => entry.options.key === 'plugin-center')!
    const face = (pluginCenterPage.inject as unknown as () => PluginCenterTabInjected)()
    expect(face.available).toBe(true)
    expect(face.development).toBe(true)
    expect(face.mutationsEnabled).toBe(true)
    const result = await face.list({ catalogKind: 'plugin', scope: 'public', query: '', limit: 24 })
    expect(result.sections.featured[0]?.pluginId).toBe('fixture.workspace-tools')
    await b.ctx.fiber.dispose()
  })
})
