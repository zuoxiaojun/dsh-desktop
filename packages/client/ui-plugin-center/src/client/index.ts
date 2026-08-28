/** Desktop Plugin Center first-level navigation and independent main page. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { resolveCatalogBridge } from './bridge.ts'
import { PluginCenterNavItem, type PluginCenterNavInjected } from './PluginCenterNavItem.tsx'
import { PluginCenterTab, type PluginCenterTabInjected } from './PluginCenterTab.tsx'
import { PluginDiscoveryNavItem, type PluginDiscoveryNavInjected } from './PluginDiscoveryNavItem.tsx'
import { PluginDiscoveryPage, type PluginDiscoveryInjected } from './PluginDiscoveryPage.tsx'
import { PresetSquareNavItem, type PresetSquareNavInjected } from './PresetSquareNavItem.tsx'
import { PresetSquarePage, type PresetSquarePageInjected } from './PresetSquarePage.tsx'
import { ApplicationCenterNavItem, type ApplicationCenterNavInjected } from './ApplicationCenterNavItem.tsx'
import {
  ApplicationCenterPage, type ApplicationCenterInjected, type ApplicationRuntimeStatus,
} from './ApplicationCenterPage.tsx'
import { en, zh, type PluginCenterLocaleKey } from './locales.ts'

export type { DesktopCatalogBridge } from './bridge.ts'
export type { PluginCenterTabInjected, PluginCenterTabProps } from './PluginCenterTab.tsx'
export type { PresetSquarePageInjected, PresetSquarePageProps } from './PresetSquarePage.tsx'
export type {
  ApplicationCenterInjected, ApplicationCenterPageProps, ApplicationRuntimeStatus,
} from './ApplicationCenterPage.tsx'
export type { PluginCenterLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop Plugin and Skill Bundle catalog copy. */
    pluginCenter: PluginCenterLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginCenter'
/** Services used by the slot contribution. */
export const inject = [
  'slots', 'layout', 'locale', 'settingsNavigation', 'sessions', 'workspaces', 'connection', 'conversation',
]

const PLUGIN_CENTER_PAGE_ID = 'plugin-center'
const PLUGIN_DISCOVERY_PAGE_ID = 'plugin-discovery'
const PRESET_SQUARE_PAGE_ID = 'preset-square'
const APPLICATION_CENTER_PAGE_ID = 'application-center'
const LLM_WIKI_STATUS_PATH = '/api/ff-llm-wiki/status'
const LLM_WIKI_OPEN_PATH = '/api/ff-llm-wiki/open'
const LLM_WIKI_SIDEBAR_VISIBILITY_KEY = 'ff-llm-wiki:sidebar-visible'
const LLM_WIKI_SIDEBAR_VISIBILITY_EVENT = 'ff-llm-wiki:sidebar-visibility'

/** Add the Desktop-only catalog as a first-level page without replacing Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-center: dictionaries')
  const resolved = resolveCatalogBridge()
  const bridge = resolved.bridge
  const unavailable = (): Promise<never> => Promise.reject(new Error('Desktop catalog bridge unavailable'))
  const hostConnection = (): ConnectionHandle => {
    const connection = ctx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error('Host connection unavailable')
    return connection
  }
  const presetInjected = (): PresetSquarePageInjected => ({
    presetAvailable: bridge?.presetSquare !== undefined,
    presetDevelopment: resolved.development,
    presetMutationsEnabled: bridge?.presetSquare?.mutationsEnabled ?? false,
    listPresetSquare: query => bridge?.presetSquare?.list(query) ?? unavailable(),
    detailPresetSquare: query => bridge?.presetSquare?.detail(query) ?? unavailable(),
    previewPresetInstall: request => bridge?.presetSquare?.previewInstall(request) ?? unavailable(),
    installPreset: request => bridge?.presetSquare?.install(request) ?? unavailable(),
    checkPresetRuntime: presetId => bridge?.presetSquare?.checkRuntime({ presetId }) ?? unavailable(),
    installPresetRuntime: presetId => bridge?.presetSquare?.installRuntime({ presetId }) ?? unavailable(),
    listLocalPresets: async () => {
      const response = await hostConnection().api.agentPresets.list({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      return {
        presets: response.result.value.presets,
        authorable: response.result.value.authorable,
      }
    },
    removeLocalPreset: async (id) => {
      const response = await hostConnection().api.agentPresets.remove({ agentPreset: id })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    describePresetCredentials: async (refs) => {
      const response = await hostConnection().api.credentials.describe({ refs: [...refs] })
      if (!response.result.ok) throw new Error(response.result.error.message)
      return response.result.value.credentials
    },
    setPresetCredential: async (ref, value) => {
      const response = await hostConnection().api.credentials.set({ ref, value })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    useLocalPreset: async (id) => {
      const workspaces = ctx.workspaces.list.getSnapshot()
      const currentSession = ctx.sessions.list.getSnapshot().current
      const currentWorkspace = currentSession === undefined
        ? undefined
        : workspaces.items.find(item => item.sessionIds.includes(currentSession))?.workspaceId
      const targetWorkspace = currentWorkspace ?? workspaces.recentWorkspaceId
      if (targetWorkspace === undefined) return 'workspace-needed'
      try {
        const sessionId = await ctx.workspaces.connectWorkspace(targetWorkspace)
        const response = await hostConnection().api.agentPresets.select({ sessionId, agentPreset: id })
        if (!response.result.ok) return 'not-ready'
        ctx.sessions.noteAgentPreset(sessionId, response.result.value.agentPreset)
        ctx.sessions.open(sessionId)
        ctx.layout.closePrimaryPage()
        return 'opened'
      } catch {
        return 'not-ready'
      }
    },
  })
  const applicationInjected = (): ApplicationCenterInjected => ({
    inspectLlmWiki: async (): Promise<ApplicationRuntimeStatus> => {
      const response = await fetch(LLM_WIKI_STATUS_PATH, { credentials: 'same-origin' })
      if (response.status === 404) return { available: false, credentialConfigured: false }
      if (!response.ok) throw new Error(`LLM Wiki status request failed: ${String(response.status)}`)
      const value = await response.json() as { readonly installed?: unknown; readonly credentialConfigured?: unknown }
      return {
        available: value.installed === true,
        credentialConfigured: value.credentialConfigured === true,
      }
    },
    openLlmWiki: () => {
      const opened = window.open(LLM_WIKI_OPEN_PATH, '_blank')
      if (opened !== null) opened.opener = null
    },
    openModelSettings: () => { ctx.settingsNavigation.open({ sectionId: 'models' }) },
    getLlmWikiSidebarVisible: () => {
      try {
        return window.localStorage.getItem(LLM_WIKI_SIDEBAR_VISIBILITY_KEY) === 'true'
      } catch {
        return false
      }
    },
    setLlmWikiSidebarVisible: (visible) => {
      window.localStorage.setItem(LLM_WIKI_SIDEBAR_VISIBILITY_KEY, String(visible))
      window.dispatchEvent(new CustomEvent(LLM_WIKI_SIDEBAR_VISIBILITY_EVENT, { detail: { visible } }))
    },
  })
  const injected = (): PluginCenterTabInjected => ({
    available: bridge !== undefined,
    development: resolved.development,
    list: query => bridge === undefined ? unavailable() : bridge.catalog.list(query),
    refresh: query => bridge === undefined ? unavailable() : bridge.catalog.refresh(query),
    detail: query => bridge === undefined ? unavailable() : bridge.catalog.detail(query),
    checkCompatibility: request => bridge === undefined ? unavailable() : bridge.catalog.checkCompatibility(request),
    listInstalled: () => bridge === undefined ? unavailable() : bridge.installedPlugins.list(),
    openPluginSettings: (tabId) => { ctx.settingsNavigation.open({ sectionId: 'plugins', tabId }) },
    mutationsEnabled: bridge?.pluginOperations.mutationsEnabled ?? false,
    install: request => bridge === undefined ? unavailable() : bridge.pluginOperations.install(request),
    manage: request => bridge === undefined ? unavailable() : bridge.pluginOperations.manage(request),
    getOwnedDataOffer: () => bridge === undefined ? Promise.resolve(null) : bridge.pluginOwnedData.getOffer(),
    removeOwnedData: request => bridge === undefined ? unavailable() : bridge.pluginOwnedData.remove(request),
    retainOwnedData: request => bridge === undefined ? unavailable() : bridge.pluginOwnedData.retain(request),
    getOperation: () => bridge === undefined ? Promise.resolve(null) : bridge.pluginOperations.getOperation(),
    onOperationState: listener => bridge === undefined ? () => {} : bridge.pluginOperations.onState(listener),
    getRecovery: () => bridge?.pluginRecovery?.getState() ?? Promise.resolve(null),
    retryRecovery: request => bridge?.pluginRecovery === undefined
      ? unavailable()
      : bridge.pluginRecovery.retry(request),
    exportRecoveryDiagnostics: request => bridge?.pluginRecovery === undefined
      ? unavailable()
      : bridge.pluginRecovery.exportDiagnostics(request),
    onRecoveryState: listener => bridge?.pluginRecovery?.onState(listener) ?? (() => {}),
  })

  const navInjected = (): PluginCenterNavInjected => ({
    pageId: PLUGIN_CENTER_PAGE_ID,
    open: () => { ctx.layout.openPrimaryPage(PLUGIN_CENTER_PAGE_ID) },
  })
  const discoveryNavInjected = (): PluginDiscoveryNavInjected => ({
    pageId: PLUGIN_DISCOVERY_PAGE_ID,
    open: () => { ctx.layout.openPrimaryPage(PLUGIN_DISCOVERY_PAGE_ID) },
  })
  const presetNavInjected = (): PresetSquareNavInjected => ({
    pageId: PRESET_SQUARE_PAGE_ID,
    open: () => { ctx.layout.openPrimaryPage(PRESET_SQUARE_PAGE_ID) },
  })
  const applicationNavInjected = (): ApplicationCenterNavInjected => ({
    pageId: APPLICATION_CENTER_PAGE_ID,
    open: () => { ctx.layout.openPrimaryPage(APPLICATION_CENTER_PAGE_ID) },
  })
  const discoveryInjected = (): PluginDiscoveryInjected => ({
    available: bridge !== undefined,
    development: resolved.development,
    list: query => bridge === undefined ? unavailable() : bridge.catalog.list(query),
    refresh: query => bridge === undefined ? unavailable() : bridge.catalog.refresh(query),
    detail: query => bridge === undefined ? unavailable() : bridge.catalog.detail(query),
    checkCompatibility: request => bridge === undefined ? unavailable() : bridge.catalog.checkCompatibility(request),
    listInstalled: () => bridge === undefined ? unavailable() : bridge.installedPlugins.list(),
    mutationsEnabled: bridge?.pluginOperations.mutationsEnabled ?? false,
    install: request => bridge === undefined ? unavailable() : bridge.pluginOperations.install(request),
    getOperation: () => bridge === undefined ? Promise.resolve(null) : bridge.pluginOperations.getOperation(),
    onOperationState: listener => bridge === undefined ? () => {} : bridge.pluginOperations.onState(listener),
    openPluginCenter: () => { ctx.layout.openPrimaryPage(PLUGIN_CENTER_PAGE_ID) },
    findWithAgent: async (requirement) => {
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        ctx.workspaces.startSession()
        return 'session-starting'
      }
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      if (connection === undefined) throw new Error('Agent connection unavailable')
      const described = await connection.api.credentials.describe({ refs: ['DEEPSEEK_API_KEY'] })
      if (!described.result.ok) throw new Error(described.result.error.message)
      if (described.result.value.credentials['DEEPSEEK_API_KEY']?.configured !== true) {
        ctx.settingsNavigation.open({ sectionId: 'models' })
        return 'needs-model'
      }
      const agentContext = ctx.sessions.scope(sessionId)
      const conversation = agentContext?.get('conversation')
      if (conversation === undefined) throw new Error('Agent session unavailable')
      await conversation.send(`/find-plugins ${requirement}`)
      ctx.layout.closePrimaryPage(PLUGIN_DISCOVERY_PAGE_ID)
      return 'sent'
    },
  })

  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: PLUGIN_CENTER_PAGE_ID,
    order: 20,
    locale: NS,
    inject: navInjected,
  }, PluginCenterNavItem))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: PLUGIN_DISCOVERY_PAGE_ID,
    order: 21,
    locale: NS,
    inject: discoveryNavInjected,
  }, PluginDiscoveryNavItem))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: PRESET_SQUARE_PAGE_ID,
    order: 22,
    locale: NS,
    inject: presetNavInjected,
  }, PresetSquareNavItem))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: APPLICATION_CENTER_PAGE_ID,
    order: 23,
    locale: NS,
    inject: applicationNavInjected,
  }, ApplicationCenterNavItem))
  ctx.slots.inject('main.page', () => ctx.slots.register({
    name: 'main.page',
    key: PLUGIN_CENTER_PAGE_ID,
    locale: NS,
    inject: injected,
  }, PluginCenterTab))
  ctx.slots.inject('main.page', () => ctx.slots.register({
    name: 'main.page',
    key: PLUGIN_DISCOVERY_PAGE_ID,
    locale: NS,
    inject: discoveryInjected,
  }, PluginDiscoveryPage))
  ctx.slots.inject('main.page', () => ctx.slots.register({
    name: 'main.page',
    key: PRESET_SQUARE_PAGE_ID,
    locale: NS,
    inject: presetInjected,
  }, PresetSquarePage))
  ctx.slots.inject('main.page', () => ctx.slots.register({
    name: 'main.page',
    key: APPLICATION_CENTER_PAGE_ID,
    locale: NS,
    inject: applicationInjected,
  }, ApplicationCenterPage))
  ctx.effect(
    () => () => {
      ctx.layout.closePrimaryPage(PLUGIN_CENTER_PAGE_ID)
      ctx.layout.closePrimaryPage(PLUGIN_DISCOVERY_PAGE_ID)
      ctx.layout.closePrimaryPage(PRESET_SQUARE_PAGE_ID)
      ctx.layout.closePrimaryPage(APPLICATION_CENTER_PAGE_ID)
    },
    'ui-plugin-center: close selected pages on teardown',
  )
}
