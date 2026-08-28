/** Preset Square browser and local roster management for the independent page. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconCloseOutline16, IconRefreshOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ManagedPresetRuntimeId,
  PresetArchiveWarning,
  PresetInstallPreviewRequest,
  PresetInstallPreviewResult,
  PresetInstallRequest,
  PresetInstallResult,
  PresetSquareDetailQuery,
  PresetSquareDetailResult,
  PresetSquareItem,
  PresetSquareListQuery,
  PresetSquareListResult,
  PresetSquareSort,
  PresetRuntimeDependencyId,
  PresetRuntimeSnapshot,
} from '@deepseek-ai/dsh-plugin-center-contracts'
import type { PluginCenterLocaleKey } from './locales.ts'
import css from './PresetSquarePanel.module.css'

/** Renderer-safe projection of one Host-owned Preset roster entry. */
export interface LocalPresetEntry {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Renderer-safe projection of the Host's live Preset roster. */
export interface LocalPresetRoster {
  readonly presets: readonly LocalPresetEntry[]
  readonly authorable: boolean
}

/** Value-free credential state returned by the Host credential seam. */
export interface PresetCredentialView {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Shared Preset operations injected by the client plugin. */
export interface PresetSquareInjected {
  readonly presetAvailable: boolean
  readonly presetDevelopment: boolean
  readonly presetMutationsEnabled: boolean
  readonly listPresetSquare: (query: PresetSquareListQuery) => Promise<PresetSquareListResult>
  readonly detailPresetSquare: (query: PresetSquareDetailQuery) => Promise<PresetSquareDetailResult>
  readonly previewPresetInstall: (request: PresetInstallPreviewRequest) => Promise<PresetInstallPreviewResult>
  readonly installPreset: (request: PresetInstallRequest) => Promise<PresetInstallResult>
  readonly checkPresetRuntime: (presetId: ManagedPresetRuntimeId) => Promise<PresetRuntimeSnapshot>
  readonly installPresetRuntime: (presetId: ManagedPresetRuntimeId) => Promise<PresetRuntimeSnapshot>
  readonly listLocalPresets: () => Promise<LocalPresetRoster>
  readonly removeLocalPreset: (id: string) => Promise<void>
  readonly describePresetCredentials: (
    refs: readonly string[],
  ) => Promise<Readonly<Record<string, PresetCredentialView>>>
  readonly setPresetCredential: (ref: string, value: string) => Promise<void>
  readonly useLocalPreset: (id: string) => Promise<'opened' | 'workspace-needed' | 'not-ready'>
}

interface PresetSquarePanelProps extends PresetSquareInjected {
  readonly t: (key: PluginCenterLocaleKey) => string
}

type PresetView = 'official' | 'community' | 'installed'
type CatalogLayout = 'grid' | 'list'

type RemoteState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly result: PresetSquareListResult }

type LocalState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly result: LocalPresetRoster }

type DetailState =
  | { readonly status: 'loading'; readonly fallback: PresetSquareItem }
  | { readonly status: 'error'; readonly fallback: PresetSquareItem }
  | { readonly status: 'ready'; readonly item: PresetSquareItem }

type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: PresetInstallPreviewResult }

type CredentialState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly values: Readonly<Record<string, PresetCredentialView>> }

type PresetSetupKind = 'ready' | 'software' | 'account' | 'credentials'

interface PresetCredentialField {
  readonly ref: string
  readonly labelKey: PluginCenterLocaleKey
  readonly secret: boolean
}

interface PresetSetup {
  readonly kind: PresetSetupKind
  readonly detailKey: PluginCenterLocaleKey
  readonly runtimeId?: ManagedPresetRuntimeId
  readonly credentials?: readonly PresetCredentialField[]
}

interface PresetCapabilitySummary {
  readonly agentKey: PluginCenterLocaleKey
  readonly skillsKey: PluginCenterLocaleKey
  readonly toolsKey: PluginCenterLocaleKey
  readonly runtimeKey: PluginCenterLocaleKey
}

const WARNING_KEYS = {
  'absolute-paths': 'presetWarningAbsolute',
  'possible-secrets': 'presetWarningSecrets',
  'version-mismatch': 'presetWarningVersion',
} as const satisfies Record<PresetArchiveWarning, PluginCenterLocaleKey>

const FEISHU_CREDENTIALS = [{
  ref: 'FEISHU_APP_ID', labelKey: 'presetFeishuAppId', secret: false,
}, {
  ref: 'FEISHU_APP_SECRET', labelKey: 'presetFeishuAppSecret', secret: true,
}, {
  ref: 'FEISHU_DEFAULT_OPEN_ID', labelKey: 'presetFeishuDefaultOpenId', secret: false,
}] as const satisfies readonly PresetCredentialField[]

const PRESET_SETUPS = {
  'ai-product-developer': { kind: 'ready', detailKey: 'presetSetupReadyDetail' },
  'dsh-motion-deck-studio': { kind: 'ready', detailKey: 'presetSetupReadyDetail' },
  'product-video-director': {
    kind: 'software', detailKey: 'presetSetupVideoDetail', runtimeId: 'product-video-director',
  },
  'ai-content-image-studio': { kind: 'account', detailKey: 'presetSetupContentDetail' },
  'ai-report-analyst': {
    kind: 'software', detailKey: 'presetSetupReportDetail', runtimeId: 'ai-report-analyst',
  },
  'feishu-digital-employee': {
    kind: 'credentials', detailKey: 'presetSetupFeishuDetail', credentials: FEISHU_CREDENTIALS,
  },
  'llm-wiki-fullstack': { kind: 'ready', detailKey: 'presetSetupReadyDetail' },
} as const satisfies Readonly<Record<string, PresetSetup>>

const PRESET_CAPABILITIES = {
  'llm-wiki-fullstack': {
    agentKey: 'presetLlmWikiAgent',
    skillsKey: 'presetLlmWikiSkills',
    toolsKey: 'presetLlmWikiTools',
    runtimeKey: 'presetLlmWikiRuntime',
  },
} as const satisfies Readonly<Record<string, PresetCapabilitySummary>>

const SETUP_BADGE_KEYS = {
  ready: 'presetSetupReady',
  software: 'presetSetupSoftware',
  account: 'presetSetupAccount',
  credentials: 'presetSetupCredentials',
} as const satisfies Record<PresetSetupKind, PluginCenterLocaleKey>

const RUNTIME_DEPENDENCY_KEYS = {
  node: 'presetRuntimeNode',
  hyperframes: 'presetRuntimeHyperframes',
  ffmpeg: 'presetRuntimeFfmpeg',
  ffprobe: 'presetRuntimeFfprobe',
  python: 'presetRuntimePython',
  openpyxl: 'presetRuntimeOpenpyxl',
  echarts: 'presetRuntimeEcharts',
  playwright: 'presetRuntimePlaywright',
  chromium: 'presetRuntimeChromium',
} as const satisfies Record<PresetRuntimeDependencyId, PluginCenterLocaleKey>

const MANAGED_RUNTIME_IDS = ['product-video-director', 'ai-report-analyst'] as const satisfies readonly ManagedPresetRuntimeId[]

function setupForPreset(id: string): PresetSetup | undefined {
  return PRESET_SETUPS[id as keyof typeof PRESET_SETUPS]
}

function capabilitiesForPreset(id: string): PresetCapabilitySummary | undefined {
  return PRESET_CAPABILITIES[id as keyof typeof PRESET_CAPABILITIES]
}

function runtimeBadgeKey(snapshot: PresetRuntimeSnapshot | undefined): PluginCenterLocaleKey {
  if (snapshot === undefined || snapshot.phase === 'checking') return 'presetRuntimeChecking'
  if (snapshot.phase === 'ready') return 'presetRuntimeReady'
  if (snapshot.phase === 'installing') return 'presetRuntimeInstalling'
  if (snapshot.phase === 'failed') return 'presetRuntimeFailed'
  return snapshot.canInstall ? 'presetRuntimeRequired' : 'presetRuntimeManual'
}

function runtimeDependencyStateKey(
  dependency: PresetRuntimeSnapshot['dependencies'][number],
): PluginCenterLocaleKey {
  if (dependency.state === 'ready') return 'presetRuntimeDependencyReady'
  if (dependency.state === 'installing') return 'presetRuntimeDependencyInstalling'
  if (dependency.state === 'failed') return 'presetRuntimeDependencyFailed'
  return dependency.installable ? 'presetRuntimeDependencyMissing' : 'presetRuntimeDependencyManual'
}

function matches(item: PresetSquareItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return true
  return [item.title, item.description, item.presetId, item.publisher.username]
    .some(value => value.toLocaleLowerCase().includes(needle))
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

function CatalogLayoutGlyph({ layout }: { readonly layout: CatalogLayout }): ReactNode {
  return layout === 'grid' ? (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
      <rect x="2.25" y="2.25" width="4.25" height="4.25" rx="1" />
      <rect x="9.5" y="2.25" width="4.25" height="4.25" rx="1" />
      <rect x="2.25" y="9.5" width="4.25" height="4.25" rx="1" />
      <rect x="9.5" y="9.5" width="4.25" height="4.25" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
      <rect x="2.25" y="2.5" width="11.5" height="3" rx="1" />
      <rect x="2.25" y="6.5" width="11.5" height="3" rx="1" />
      <rect x="2.25" y="10.5" width="11.5" height="3" rx="1" />
    </svg>
  )
}

function OfficialPresetGlyph({ presetId }: { readonly presetId: string }): ReactNode {
  const common = {
    viewBox: '0 0 32 32',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (presetId) {
    case 'ai-product-developer':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="25" height="22" rx="4" fill="currentColor" opacity=".14" stroke="none" />
          <rect x="4.5" y="6" width="23" height="20" rx="3" />
          <path d="M4.5 11.5h23M12.5 16l-3 3 3 3M19.5 16l3 3-3 3" />
          <circle cx="8" cy="8.75" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'dsh-motion-deck-studio':
      return (
        <svg {...common}>
          <rect x="5" y="4" width="21" height="18" rx="3.5" fill="currentColor" opacity=".14" stroke="none" />
          <rect x="6" y="5" width="19" height="16" rx="2.5" />
          <path d="M10 27h12M16 21v6M12.5 10.5l7 3.5-7 3.5z" />
          <path d="M9.5 8.5h4" opacity=".7" />
        </svg>
      )
    case 'product-video-director':
      return (
        <svg {...common}>
          <rect x="4" y="8" width="24" height="18" rx="3.5" fill="currentColor" opacity=".14" stroke="none" />
          <path d="M5 9h22v16H5zM5 14h22M10 9l3 5M18 9l3 5M13 18l6 3.5-6 3.5z" />
          <path d="M6 4.5h20l-2.5 4.5H3.5z" fill="currentColor" opacity=".34" />
        </svg>
      )
    case 'ai-content-image-studio':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="22" height="22" rx="4" fill="currentColor" opacity=".14" stroke="none" />
          <rect x="4.5" y="6" width="20" height="20" rx="3" />
          <circle cx="10.5" cy="12" r="2" />
          <path d="M7.5 22l5-5 3.5 3 3-3 5.5 5M25 4v6M22 7h6" />
          <circle cx="25" cy="7" r="2.2" fill="currentColor" opacity=".24" stroke="none" />
        </svg>
      )
    case 'ai-report-analyst':
      return (
        <svg {...common}>
          <path d="M5 4h19a3 3 0 013 3v20H5z" fill="currentColor" opacity=".14" stroke="none" />
          <path d="M6 5v21h21M10 21v-5M15 21V10M20 21v-8M9 12l5-4 5 2 7-6" />
          <circle cx="14" cy="8" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'feishu-digital-employee':
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="5.5" fill="currentColor" opacity=".18" stroke="none" />
          <circle cx="16" cy="16" r="3.5" />
          <circle cx="7" cy="8" r="2.5" fill="currentColor" opacity=".34" />
          <circle cx="25" cy="8" r="2.5" fill="currentColor" opacity=".34" />
          <circle cx="7" cy="24" r="2.5" fill="currentColor" opacity=".34" />
          <circle cx="25" cy="24" r="2.5" fill="currentColor" opacity=".34" />
          <path d="M9 9.7l4 3.3M23 9.7L19 13M9.1 22.2l3.9-3.1M22.9 22.2L19 19.1" />
        </svg>
      )
    case 'llm-wiki-fullstack':
      return (
        <svg {...common}>
          <path d="M4.5 5.5h9.2c2.2 0 3.5 1.2 3.5 3.3V27c0-2.1-1.3-3.3-3.5-3.3H4.5z" fill="currentColor" opacity=".15" stroke="none" />
          <path d="M27.5 5.5h-9.2c-2.2 0-3.5 1.2-3.5 3.3V27c0-2.1 1.3-3.3 3.5-3.3h9.2z" fill="currentColor" opacity=".25" stroke="none" />
          <path d="M5.5 6.5h8.2c2 0 3.3 1.2 3.3 3.3V26c0-2.1-1.3-3.3-3.3-3.3H5.5zM26.5 6.5h-8.2" />
          <path d="M26.5 6.5v16.2h-8.2M9 11h4.5M9 15h4.5M23 11h-4.5M23 15h-4.5" />
          <circle cx="22" cy="20" r="2.4" fill="currentColor" opacity=".38" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M16 4l2.1 7.1L25 14l-6.9 2.9L16 24l-2.1-7.1L7 14l6.9-2.9z" />
          <path d="M25 5v5M22.5 7.5h5" />
        </svg>
      )
  }
}

function CommunityPresetGlyph({ variant }: { readonly variant: number }): ReactNode {
  const common = {
    viewBox: '0 0 32 32',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (variant % 6) {
    case 1:
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="4" />
          <circle cx="7" cy="9" r="2.5" />
          <circle cx="25" cy="9" r="2.5" />
          <circle cx="16" cy="26" r="2.5" />
          <path d="M9 10.5l4 3M23 10.5l-4 3M16 20v3.5" />
        </svg>
      )
    case 2:
      return (
        <svg {...common}>
          <path d="M8 4.5h11l5 5V27H8zM19 4.5V10h5M12 15h8M12 20h8" />
        </svg>
      )
    case 3:
      return (
        <svg {...common}>
          <rect x="4.5" y="6" width="23" height="20" rx="3" />
          <path d="M9 12l4 4-4 4M16 20h7" />
        </svg>
      )
    case 4:
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="7" />
          <path d="M19 19l7 7M11 14h6M14 11v6" />
        </svg>
      )
    case 5:
      return (
        <svg {...common}>
          <rect x="5" y="5" width="9" height="9" rx="2" />
          <rect x="18" y="5" width="9" height="9" rx="2" />
          <rect x="5" y="18" width="9" height="9" rx="2" />
          <path d="M22.5 18v9M18 22.5h9" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M16 4l2.1 7.1L25 14l-6.9 2.9L16 24l-2.1-7.1L7 14l6.9-2.9z" />
          <path d="M25 5v5M22.5 7.5h5" />
        </svg>
      )
  }
}

function PresetArtwork({ item, compact = false, local = false }: {
  readonly item: PresetSquareItem
  readonly compact?: boolean
  readonly local?: boolean
}): ReactNode {
  return (
    <span
      className={`${css.artwork}${compact ? ` ${css.artworkCompact}` : ''}${local ? ` ${css.artworkLocal}` : ''}`}
      data-variant={String(item.source === 'fufan-official' ? item.visualVariant : item.visualVariant % 6)}
      data-artwork={item.source === 'fufan-official' ? item.presetId : 'community-fallback'}
      aria-hidden="true"
    >
      {item.source === 'fufan-official'
        ? <OfficialPresetGlyph presetId={item.presetId} />
        : <CommunityPresetGlyph variant={item.visualVariant} />}
    </span>
  )
}

/** Shared first-party UI over the fixed-origin Preset Square and Host roster. */
export function PresetSquarePanel({
  presetAvailable,
  presetDevelopment,
  presetMutationsEnabled,
  listPresetSquare,
  detailPresetSquare,
  previewPresetInstall,
  installPreset,
  checkPresetRuntime,
  installPresetRuntime,
  listLocalPresets,
  removeLocalPreset,
  describePresetCredentials,
  setPresetCredential,
  useLocalPreset,
  t,
}: PresetSquarePanelProps): ReactNode {
  const [view, setView] = useState<PresetView>('official')
  const [catalogLayout, setCatalogLayout] = useState<CatalogLayout>('grid')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PresetSquareSort>('downloads')
  const [remoteRevision, setRemoteRevision] = useState(0)
  const [localRevision, setLocalRevision] = useState(0)
  const [remote, setRemote] = useState<RemoteState>({ status: 'loading' })
  const [local, setLocal] = useState<LocalState>({ status: 'loading' })
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [targetId, setTargetId] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<LocalPresetEntry | null>(null)
  const [removing, setRemoving] = useState(false)
  const [feedback, setFeedback] = useState<PluginCenterLocaleKey | null>(null)
  const [credentialState, setCredentialState] = useState<CredentialState>({ status: 'idle' })
  const [credentialInputs, setCredentialInputs] = useState<Readonly<Record<string, string>>>({})
  const [credentialFeedback, setCredentialFeedback] = useState<PluginCenterLocaleKey | null>(null)
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<Readonly<Partial<Record<ManagedPresetRuntimeId, PresetRuntimeSnapshot>>>>({})
  const [runtimeConfirm, setRuntimeConfirm] = useState(false)
  const [runtimeInstallTarget, setRuntimeInstallTarget] = useState<ManagedPresetRuntimeId | null>(null)

  useEffect(() => {
    if (!presetAvailable) return
    let current = true
    setRemote({ status: 'loading' })
    void Promise.resolve().then(() => listPresetSquare({ query: '', sort })).then(
      (result) => { if (current) setRemote({ status: 'ready', result }) },
      () => { if (current) setRemote({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listPresetSquare, presetAvailable, remoteRevision, sort])

  useEffect(() => {
    if (!presetAvailable) return
    let current = true
    setLocal({ status: 'loading' })
    void Promise.resolve().then(listLocalPresets).then(
      (result) => { if (current) setLocal({ status: 'ready', result }) },
      () => { if (current) setLocal({ status: 'error' }) },
    )
    return () => { current = false }
  }, [listLocalPresets, localRevision, presetAvailable])

  useEffect(() => {
    if (!presetAvailable) return
    let current = true
    for (const presetId of MANAGED_RUNTIME_IDS) {
      void checkPresetRuntime(presetId).then(
        (snapshot) => {
          if (!current) return
          setRuntimeSnapshots((values) => {
            const previous = values[presetId]
            return previous !== undefined && previous.revision > snapshot.revision
              ? values
              : { ...values, [presetId]: snapshot }
          })
        },
        () => {
          if (!current) return
          setRuntimeSnapshots(values => ({ ...values, [presetId]: {
            presetId,
            phase: 'failed',
            dependencies: [],
            canInstall: false,
            revision: 0,
            updatedAt: new Date().toISOString(),
          } }))
        },
      )
    }
    return () => { current = false }
  }, [checkPresetRuntime, presetAvailable])

  const visible = useMemo(() => remote.status === 'ready'
    ? remote.result.items.filter(item => matches(item, query))
    : [], [query, remote])
  const officialVisible = useMemo(() => visible
    .filter(item => item.source === 'fufan-official')
    .sort((left, right) => Number(right.presetId === 'llm-wiki-fullstack')
      - Number(left.presetId === 'llm-wiki-fullstack')), [visible])
  const communityVisible = useMemo(() => visible.filter(item => item.source === 'community'), [visible])
  const officialCount = remote.status === 'ready'
    ? remote.result.items.filter(item => item.source === 'fufan-official').length
    : 0
  const communityCount = remote.status === 'ready'
    ? remote.result.items.filter(item => item.source === 'community').length
    : 0
  const catalogVisible = view === 'official' ? officialVisible : communityVisible
  const catalogTitle = view === 'official' ? t('presetFufanOfficialTitle') : t('presetCommunityTitle')
  const catalogHint = view === 'official' ? t('presetFufanOfficialHint') : t('presetCommunityHint')
  const catalogView = view !== 'installed'

  const localById = useMemo(() => new Map(local.status === 'ready'
    ? local.result.presets.map(item => [item.id, item] as const)
    : []), [local])
  const remoteByPresetId = useMemo(() => new Map(remote.status === 'ready'
    ? remote.result.items.map(item => [item.presetId, item] as const)
    : []), [remote])

  const acceptRuntimeSnapshot = (snapshot: PresetRuntimeSnapshot): void => {
    setRuntimeSnapshots((values) => {
      const previous = values[snapshot.presetId]
      return previous !== undefined && previous.revision > snapshot.revision
        ? values
        : { ...values, [snapshot.presetId]: snapshot }
    })
  }

  const failedRuntimeSnapshot = (
    presetId: ManagedPresetRuntimeId,
    previous?: PresetRuntimeSnapshot,
  ): PresetRuntimeSnapshot => {
    const dependencies = (previous?.dependencies ?? []).map(dependency => (
      dependency.state === 'installing' ? { ...dependency, state: 'failed' as const } : dependency
    ))
    return {
      presetId,
      phase: 'failed',
      dependencies,
      canInstall: dependencies.some(dependency => dependency.state !== 'ready' && dependency.installable),
      revision: previous?.revision ?? 0,
      updatedAt: new Date().toISOString(),
    }
  }

  const refreshRuntime = (presetId: ManagedPresetRuntimeId): void => {
    const previous = runtimeSnapshots[presetId]
    setRuntimeSnapshots(values => ({ ...values, [presetId]: {
      presetId,
      phase: 'checking',
      dependencies: previous?.dependencies ?? [],
      canInstall: previous?.canInstall ?? false,
      revision: previous?.revision ?? 0,
      updatedAt: new Date().toISOString(),
    } }))
    void checkPresetRuntime(presetId).then(
      acceptRuntimeSnapshot,
      () => { setRuntimeSnapshots(values => ({
        ...values,
        [presetId]: failedRuntimeSnapshot(presetId, values[presetId]),
      })) },
    )
  }

  const installRuntime = (presetId: ManagedPresetRuntimeId): void => {
    if (runtimeInstallTarget !== null) return
    const previous = runtimeSnapshots[presetId]
    setRuntimeConfirm(false)
    setRuntimeInstallTarget(presetId)
    setRuntimeSnapshots(values => ({ ...values, [presetId]: {
      presetId,
      phase: 'installing',
      dependencies: (previous?.dependencies ?? []).map(dependency => (
        dependency.state !== 'ready' && dependency.installable
          ? { ...dependency, state: 'installing' as const }
          : dependency
      )),
      canInstall: previous?.canInstall ?? false,
      revision: previous?.revision ?? 0,
      updatedAt: new Date().toISOString(),
    } }))
    void installPresetRuntime(presetId).then(
      acceptRuntimeSnapshot,
      () => { setRuntimeSnapshots(values => ({
        ...values,
        [presetId]: failedRuntimeSnapshot(presetId, values[presetId]),
      })) },
    ).finally(() => { setRuntimeInstallTarget(null) })
  }

  const loadCredentials = (presetId: string): void => {
    const fields = setupForPreset(presetId)?.credentials
    setCredentialInputs({})
    if (fields === undefined) {
      setCredentialState({ status: 'idle' })
      return
    }
    setCredentialState({ status: 'loading' })
    void describePresetCredentials(fields.map(field => field.ref)).then(
      (values) => { setCredentialState({ status: 'ready', values }) },
      () => { setCredentialState({ status: 'error' }) },
    )
  }

  const closeDetail = (): void => {
    if (installing || savingCredentials || runtimeInstallTarget !== null) return
    setDetail(null)
    setPreview({ status: 'idle' })
    setTargetId('')
    setAcknowledged(false)
    setCredentialState({ status: 'idle' })
    setCredentialInputs({})
    setCredentialFeedback(null)
    setRuntimeConfirm(false)
  }

  const openDetail = (item: PresetSquareItem, setupRequired = false): void => {
    setDetail({ status: 'loading', fallback: item })
    setPreview({ status: 'idle' })
    setTargetId(item.presetId)
    setAcknowledged(false)
    setCredentialFeedback(setupRequired ? 'presetSetupRequired' : null)
    const runtimeId = setupForPreset(item.presetId)?.runtimeId
    setRuntimeConfirm(setupRequired && runtimeId !== undefined
      && runtimeSnapshots[runtimeId]?.canInstall === true)
    loadCredentials(item.presetId)
    void detailPresetSquare({ slug: item.slug }).then(
      (result) => {
        if (result.item === null) setDetail({ status: 'error', fallback: item })
        else setDetail({ status: 'ready', item: result.item })
      },
      () => { setDetail({ status: 'error', fallback: item }) },
    )
  }

  const startPreview = (item: PresetSquareItem, requestedTarget: string | null = null): void => {
    if (!presetMutationsEnabled) {
      setFeedback('presetDesktopOnly')
      return
    }
    if (detail === null) openDetail(item)
    setPreview({ status: 'loading' })
    setAcknowledged(false)
    void previewPresetInstall({ slug: item.slug, targetId: requestedTarget }).then(
      (value) => {
        setTargetId(value.targetId)
        setPreview({ status: 'ready', value })
      },
      () => { setPreview({ status: 'error' }) },
    )
  }

  const selectedItem = detail === null
    ? null
    : detail.status === 'ready' ? detail.item : detail.fallback
  const selectedInstalled = selectedItem === null ? undefined : localById.get(selectedItem.presetId)
  const selectedSetup = selectedItem === null ? undefined : setupForPreset(selectedItem.presetId)
  const selectedCapabilities = selectedItem === null ? undefined : capabilitiesForPreset(selectedItem.presetId)
  const selectedRuntime = selectedSetup?.runtimeId === undefined
    ? undefined
    : runtimeSnapshots[selectedSetup.runtimeId]
  const saveCredentials = (): void => {
    const fields = selectedSetup?.credentials
    if (fields === undefined || credentialState.status !== 'ready' || savingCredentials) return
    const writes = fields.flatMap((field) => {
      const value = credentialInputs[field.ref]?.trim() ?? ''
      return value === '' ? [] : [{ ref: field.ref, value }]
    })
    if (writes.length === 0) return
    const missingInput = fields.some((field) => {
      const status = credentialState.values[field.ref]
      return status?.configured !== true && (credentialInputs[field.ref]?.trim() ?? '') === ''
    })
    if (missingInput) {
      setCredentialFeedback('presetCredentialIncomplete')
      return
    }
    setSavingCredentials(true)
    setCredentialFeedback(null)
    void writes.reduce<Promise<void>>(
      (chain, entry) => chain.then(() => setPresetCredential(entry.ref, entry.value)),
      Promise.resolve(),
    ).then(
      () => describePresetCredentials(fields.map(field => field.ref)),
    ).then(
      (values) => {
        setCredentialState({ status: 'ready', values })
        setCredentialInputs({})
        setCredentialFeedback('presetCredentialSaved')
      },
      () => { setCredentialFeedback('presetCredentialSaveFailed') },
    ).finally(() => { setSavingCredentials(false) })
  }

  const confirmInstall = (): void => {
    if (selectedItem === null || installing || !acknowledged || targetId.trim() === '') return
    setInstalling(true)
    setFeedback(null)
    void previewPresetInstall({ slug: selectedItem.slug, targetId: targetId.trim() }).then(
      (checked) => {
        setPreview({ status: 'ready', value: checked })
        setTargetId(checked.targetId)
        if (checked.conflict) throw new Error('preset id conflict')
        return installPreset({ slug: selectedItem.slug, targetId: checked.targetId })
      },
    ).then(
      async () => {
        const setup = setupForPreset(selectedItem.presetId)
        const runtime = setup?.runtimeId === undefined
          ? undefined
          : await checkPresetRuntime(setup.runtimeId).catch(() => undefined)
        if (runtime !== undefined) acceptRuntimeSnapshot(runtime)
        setFeedback(setup === undefined || setup.kind === 'ready'
          ? 'presetInstallSuccess'
          : 'presetInstallSuccessSetup')
        setLocalRevision(value => value + 1)
        setPreview({ status: 'idle' })
        setTargetId('')
        setAcknowledged(false)
        if (setup?.runtimeId !== undefined && runtime?.phase !== 'ready') {
          setRuntimeConfirm(runtime?.canInstall === true)
          return
        }
        setDetail(null)
      },
      () => { setFeedback('presetInstallFailed') },
    ).finally(() => { setInstalling(false) })
  }

  const confirmRemove = (): void => {
    if (removeTarget === null || removing) return
    setRemoving(true)
    setFeedback(null)
    void removeLocalPreset(removeTarget.id).then(
      () => {
        setRemoveTarget(null)
        setLocalRevision(value => value + 1)
      },
      () => { setFeedback('presetRemoveFailed') },
    ).finally(() => { setRemoving(false) })
  }

  const usePreset = (id: string): void => {
    setFeedback(null)
    const applyPreset = (): void => { void useLocalPreset(id).then(
      (result) => {
        if (result === 'workspace-needed') setFeedback('presetWorkspaceNeeded')
        if (result === 'not-ready') setFeedback('presetUseNotReady')
      },
      () => { setFeedback('presetUseFailed') },
    ) }
    const setup = setupForPreset(id)
    const openRequiredSetup = (confirmRuntime = false): void => {
      const item = remote.status === 'ready'
        ? remote.result.items.find(candidate => candidate.presetId === id)
        : undefined
      if (item === undefined) {
        setFeedback('presetSetupRequired')
        return
      }
      setView(item.source === 'fufan-official' ? 'official' : 'community')
      openDetail(item, true)
      if (confirmRuntime) setRuntimeConfirm(true)
    }
    const checkCredentials = (): void => {
      const fields = setup?.credentials
      if (fields === undefined) {
        applyPreset()
        return
      }
      void describePresetCredentials(fields.map(field => field.ref)).then(
        (values) => {
          if (fields.every(field => values[field.ref]?.configured === true)) {
            applyPreset()
            return
          }
          openRequiredSetup()
        },
        () => { setFeedback('presetUseFailed') },
      )
    }
    const runtimeId = setup?.runtimeId
    if (runtimeId === undefined) {
      checkCredentials()
      return
    }
    void checkPresetRuntime(runtimeId).then(
      (snapshot) => {
        acceptRuntimeSnapshot(snapshot)
        if (snapshot.phase === 'ready') {
          checkCredentials()
        } else {
          openRequiredSetup(snapshot.canInstall)
        }
      },
      () => {
        setRuntimeSnapshots(values => ({
          ...values,
          [runtimeId]: failedRuntimeSnapshot(runtimeId, values[runtimeId]),
        }))
        openRequiredSetup()
      },
    )
  }

  const runtimeForSetup = (setup: PresetSetup | undefined): PresetRuntimeSnapshot | undefined => (
    setup?.runtimeId === undefined ? undefined : runtimeSnapshots[setup.runtimeId]
  )

  const actionKeyForInstalled = (setup: PresetSetup | undefined): PluginCenterLocaleKey => {
    if (setup?.runtimeId === undefined) return 'presetUse'
    const runtime = runtimeSnapshots[setup.runtimeId]
    if (runtimeInstallTarget === setup.runtimeId || runtime?.phase === 'installing') {
      return 'presetRuntimeInstalling'
    }
    return runtime?.phase === 'ready' ? 'presetUse' : 'presetRuntimeConfigureAction'
  }

  const renderRuntimeSetup = (setup: PresetSetup): ReactNode => {
    if (setup.runtimeId === undefined) return null
    const runtimeId = setup.runtimeId
    const snapshot = runtimeSnapshots[runtimeId]
    const busy = runtimeInstallTarget === runtimeId || snapshot?.phase === 'installing'
    return (
      <div className={css.runtimeSetup} data-phase={snapshot?.phase ?? 'checking'}>
        <div className={css.runtimeSetupHeading}>
          <strong>{t('presetRuntimeTitle')}</strong>
          <span>{t(runtimeBadgeKey(snapshot))}</span>
        </div>
        {snapshot === undefined || snapshot.phase === 'checking' ? (
          <p>{t('presetRuntimeCheckingDetail')}</p>
        ) : null}
        {snapshot !== undefined && snapshot.dependencies.length > 0 ? (
          <ul className={css.runtimeDependencies}>
            {snapshot.dependencies.map(dependency => (
              <li key={dependency.id} data-state={dependency.state}>
                <span>{t(RUNTIME_DEPENDENCY_KEYS[dependency.id])}</span>
                <em>{dependency.version ?? t(runtimeDependencyStateKey(dependency))}</em>
              </li>
            ))}
          </ul>
        ) : null}
        {snapshot?.phase === 'ready' ? <p className={css.runtimeSuccess}>{t('presetRuntimeReadyDetail')}</p> : null}
        {snapshot?.phase === 'failed' ? <p className={css.runtimeFailure}>{t('presetRuntimeFailureDetail')}</p> : null}
        {snapshot?.phase === 'missing' && !snapshot.canInstall ? (
          <p className={css.runtimeManual}>{t('presetRuntimeManualDetail')}</p>
        ) : null}
        {runtimeConfirm ? (
          <div className={css.runtimeConfirmation} role="alert">
            <strong>{t('presetRuntimeConfirmTitle')}</strong>
            <p>{t('presetRuntimeConfirmDetail')}</p>
            <div>
              <button type="button" disabled={busy} onClick={() => { setRuntimeConfirm(false) }}>
                {t('cancel')}
              </button>
              <button type="button" className={css.primary} disabled={busy} onClick={() => { installRuntime(runtimeId) }}>
                {t('presetRuntimeConfirmAction')}
              </button>
            </div>
          </div>
        ) : (
          <div className={css.runtimeActions}>
            <button type="button" disabled={busy} onClick={() => { refreshRuntime(runtimeId) }}>
              {t('presetRuntimeRecheck')}
            </button>
            {snapshot?.canInstall === true && snapshot.phase !== 'ready' ? (
              <button type="button" className={css.primary} disabled={busy} onClick={() => { setRuntimeConfirm(true) }}>
                {busy ? t('presetRuntimeInstalling') : t('presetRuntimeInstallAction')}
              </button>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const renderCards = (items: readonly PresetSquareItem[]): ReactNode => (
    <div className={css.grid} data-layout={catalogLayout}>
      {items.map((item) => {
        const installed = localById.get(item.presetId)
        const setup = setupForPreset(item.presetId)
        const runtime = runtimeForSetup(setup)
        return (
          <article key={item.slug} className={css.card} data-source={item.source}>
            <PresetArtwork item={item} />
            <div className={css.cardCopy}>
              <div className={css.cardTitle}>
                <strong>{item.title}</strong>
                {item.source === 'fufan-official' ? <span>{t('presetFufanOfficialBadge')}</span> : null}
              </div>
              <p>{item.description}</p>
              <div className={css.cardMeta}>
                <span>{item.source === 'fufan-official'
                  ? t('presetFufanOfficialPackage')
                  : `@${item.publisher.username} · ${item.downloadCount.toLocaleString()} ${t('presetDownloads')}`}</span>
                {setup === undefined ? null : (
                  <em data-kind={setup.kind}>{t(setup.runtimeId === undefined
                    ? SETUP_BADGE_KEYS[setup.kind]
                    : runtimeBadgeKey(runtime))}</em>
                )}
              </div>
            </div>
            <div className={css.cardActions}>
              <button type="button" onClick={() => { openDetail(item) }}>{t('details')}</button>
              {installed === undefined ? (
                <button
                  type="button"
                  className={css.primary}
                  disabled={!presetMutationsEnabled || local.status !== 'ready'}
                  onClick={() => { startPreview(item) }}
                >
                  {t('install')}
                </button>
              ) : (
                <button
                  type="button"
                  className={css.primary}
                  disabled={!presetMutationsEnabled || installed.broken !== undefined
                    || runtimeInstallTarget === setup?.runtimeId}
                  onClick={() => {
                    if (setup?.runtimeId !== undefined && runtime?.phase !== 'ready') openDetail(item, true)
                    else usePreset(installed.id)
                  }}
                >
                  {t(actionKeyForInstalled(setup))}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )

  if (!presetAvailable) {
    return <div className={css.unavailable}><p>{t('presetDesktopOnly')}</p></div>
  }

  return (
    <div
      className={css.root}
      data-development={presetDevelopment || undefined}
      aria-busy={remote.status === 'loading' || local.status === 'loading'
        || installing || removing || savingCredentials || runtimeInstallTarget !== null}
    >
      <div className={css.scroller}>
        <main className={css.content}>
          <header className={css.header}>
            <div>
              <h1>{t('presetTitle')}</h1>
              <p>{t('presetIntro')}</p>
            </div>
            <button
              type="button"
              className={css.refresh}
              aria-label={t('refresh')}
              title={t('refresh')}
              onClick={() => {
                setRemoteRevision(value => value + 1)
                setLocalRevision(value => value + 1)
              }}
            >
              <IconRefreshOutline16 size={16} />
            </button>
          </header>

          <div className={css.viewTabs} role="tablist" aria-label={t('presetTitle')}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'official'}
              data-active={view === 'official' || undefined}
              onClick={() => { setView('official') }}
            >
              <span>{t('presetFufanOfficialTitle')}</span>
              {remote.status === 'ready' ? <em>{officialCount}</em> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'community'}
              data-active={view === 'community' || undefined}
              onClick={() => { setView('community') }}
            >
              <span>{t('presetCommunityTitle')}</span>
              {remote.status === 'ready' ? <em>{communityCount}</em> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'installed'}
              data-active={view === 'installed' || undefined}
              onClick={() => { setView('installed') }}
            >
              <span>{t('presetInstalledTab')}</span>
              {local.status === 'ready' ? <em>{local.result.presets.length}</em> : null}
            </button>
          </div>

          {feedback === null ? null : <p className={css.feedback} role="status">{t(feedback)}</p>}
          {!presetMutationsEnabled ? <p className={css.desktopNote}>{t('presetDesktopOnly')}</p> : null}

          {catalogView ? <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('presetSearch')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('presetSearch')}
              aria-label={t('presetSearch')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label> : null}

          {view === 'installed' ? <section className={css.section} aria-labelledby="local-presets-heading">
            <div className={css.sectionHeading}>
              <h2 id="local-presets-heading">{t('presetInstalledTitle')}</h2>
              {local.status === 'error' ? (
                <button type="button" onClick={() => { setLocalRevision(value => value + 1) }}>{t('retry')}</button>
              ) : null}
            </div>
            {local.status === 'loading' ? <div className={css.localSkeleton} /> : null}
            {local.status === 'error' ? <p className={css.status} role="alert">{t('presetLocalError')}</p> : null}
            {local.status === 'ready' ? (
              <div className={css.localList}>
                {local.result.presets.length === 0 ? <p className={css.status}>{t('presetInstalledEmpty')}</p> : null}
                {local.result.presets.map((item) => {
                  const catalogItem = remoteByPresetId.get(item.id)
                  return (
                    <article
                      key={item.id}
                      className={css.localItem}
                      data-broken={item.broken === undefined ? undefined : true}
                    >
                      {catalogItem === undefined
                        ? (
                          <span className={css.localMark} aria-hidden="true">
                            {(item.name ?? item.id).slice(0, 1).toLocaleUpperCase()}
                          </span>
                        )
                        : <PresetArtwork item={catalogItem} local />}
                      <div className={css.localCopy}>
                        <strong>{item.name ?? item.id}</strong>
                        <span>{item.description ?? item.id}</span>
                        {item.broken === undefined ? null : <em title={item.broken}>{t('presetBroken')}</em>}
                      </div>
                      <span className={css.trust} data-trust={item.trust}>
                        {t(item.trust === 'system' ? 'presetSystem' : 'presetUser')}
                      </span>
                      <div className={css.localActions}>
                        <button
                          type="button"
                          disabled={!presetMutationsEnabled || item.broken !== undefined
                            || runtimeInstallTarget === setupForPreset(item.id)?.runtimeId}
                          onClick={() => { usePreset(item.id) }}
                        >
                          {t(actionKeyForInstalled(setupForPreset(item.id)))}
                        </button>
                        {item.trust === 'user' ? (
                          <button
                            type="button"
                            className={css.danger}
                            disabled={!presetMutationsEnabled}
                            onClick={() => { setRemoveTarget(item) }}
                          >
                            {t('presetRemove')}
                          </button>
                        ) : <span className={css.protected}>{t('presetProtected')}</span>}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : null}
          </section> : null}

          {catalogView ? <section className={css.section} aria-labelledby="square-presets-heading">
            <div className={css.sectionHeading}>
              <div className={css.catalogHeadingCopy}>
                <h2 id="square-presets-heading">{catalogTitle}</h2>
                <p>{catalogHint}</p>
              </div>
              <div className={css.catalogControls}>
                {view === 'community' ? <div className={css.sort} aria-label={t('presetSquareTitle')}>
                  {(['downloads', 'newest'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={sort === value}
                      onClick={() => { setSort(value) }}
                    >
                      {t(value === 'downloads' ? 'presetSortDownloads' : 'presetSortNewest')}
                    </button>
                  ))}
                </div> : null}
                <div className={css.layoutSwitch} role="group" aria-label={t('presetLayout')}>
                  {(['grid', 'list'] as const).map(layout => (
                    <button
                      key={layout}
                      type="button"
                      aria-label={t(layout === 'grid' ? 'presetGridView' : 'presetListView')}
                      title={t(layout === 'grid' ? 'presetGridView' : 'presetListView')}
                      aria-pressed={catalogLayout === layout}
                      onClick={() => { setCatalogLayout(layout) }}
                    >
                      <CatalogLayoutGlyph layout={layout} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {remote.status === 'loading' ? (
              <div className={css.grid} data-layout={catalogLayout} role="status" aria-label={t('presetLoading')}>
                {[0, 1, 2, 3].map(value => <span key={value} className={css.cardSkeleton} />)}
              </div>
            ) : null}
            {remote.status === 'error' ? (
              <div className={css.failure} role="alert">
                <span>{t('presetError')}</span>
                <button type="button" onClick={() => { setRemoteRevision(value => value + 1) }}>{t('retry')}</button>
              </div>
            ) : null}
            {remote.status === 'ready' && catalogVisible.length === 0 ? <p className={css.status}>{t('presetEmpty')}</p> : null}
            {remote.status === 'ready' && catalogVisible.length > 0 ? renderCards(catalogVisible) : null}
          </section> : null}
        </main>
      </div>

      {detail === null || selectedItem === null ? null : (
        <div className={css.overlay} role="presentation">
          <section className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="preset-detail-title">
            <header className={css.dialogHeader}>
              <PresetArtwork item={selectedItem} compact />
              <div>
                <span>{t('presetDetails')}</span>
                <h2 id="preset-detail-title">{selectedItem.title}</h2>
              </div>
              <button
                type="button"
                aria-label={t('close')}
                disabled={installing || savingCredentials || runtimeInstallTarget !== null}
                onClick={closeDetail}
              >
                <IconCloseOutline16 size={16} />
              </button>
            </header>
            <div className={css.dialogBody}>
              {detail.status === 'loading' ? <p className={css.status}>{t('detailLoading')}</p> : null}
              {detail.status === 'error' ? <p className={css.failureText}>{t('detailError')}</p> : null}
              <p className={css.description}>{selectedItem.description}</p>
              {selectedItem.source === 'fufan-official' ? (
                <div className={css.officialNotice}>
                  <strong>{t('presetFufanOfficialBadge')}</strong>
                  <p>{t('presetFufanOfficialDisclaimer')}</p>
                </div>
              ) : null}
              {selectedCapabilities === undefined ? null : (
                <section className={css.capabilitiesPanel} aria-labelledby="preset-capabilities-title">
                  <header>
                    <strong id="preset-capabilities-title">{t('presetCapabilitiesTitle')}</strong>
                    <p>{t('presetCapabilitiesHint')}</p>
                  </header>
                  <dl>
                    <div>
                      <dt>{t('presetCapabilityAgent')}</dt>
                      <dd>{t(selectedCapabilities.agentKey)}</dd>
                    </div>
                    <div>
                      <dt>{t('presetCapabilitySkills')}</dt>
                      <dd>{t(selectedCapabilities.skillsKey)}</dd>
                    </div>
                    <div>
                      <dt>{t('presetCapabilityTools')}</dt>
                      <dd>{t(selectedCapabilities.toolsKey)}</dd>
                    </div>
                    <div>
                      <dt>{t('presetCapabilityRuntime')}</dt>
                      <dd>{t(selectedCapabilities.runtimeKey)}</dd>
                    </div>
                  </dl>
                </section>
              )}
              {selectedSetup === undefined ? null : (
                <section className={css.setupNotice} data-kind={selectedSetup.kind} aria-labelledby="preset-setup-title">
                  <header>
                    <strong id="preset-setup-title">{t('presetSetupTitle')}</strong>
                    <span>{t(selectedSetup.runtimeId === undefined
                      ? SETUP_BADGE_KEYS[selectedSetup.kind]
                      : runtimeBadgeKey(selectedRuntime))}</span>
                  </header>
                  <p>{t('presetSetupCommon')}</p>
                  <ul><li>{t(selectedSetup.detailKey)}</li></ul>
                  {selectedSetup.kind === 'ready' || selectedSetup.runtimeId !== undefined
                    ? null
                    : <small>{t('presetSetupInstallNote')}</small>}
                  {renderRuntimeSetup(selectedSetup)}
                  {selectedSetup.credentials === undefined ? null : (
                    <div className={css.credentialForm}>
                      <strong>{t('presetCredentialTitle')}</strong>
                      <p>{t('presetCredentialPrivacy')}</p>
                      {credentialFeedback === null ? null : (
                        <p className={css.credentialFeedback} role="status">{t(credentialFeedback)}</p>
                      )}
                      {credentialState.status === 'loading' ? <p>{t('presetCredentialLoading')}</p> : null}
                      {credentialState.status === 'error' ? (
                        <div className={css.failure} role="alert">
                          <span>{t('presetCredentialLoadFailed')}</span>
                          <button type="button" onClick={() => { loadCredentials(selectedItem.presetId) }}>{t('retry')}</button>
                        </div>
                      ) : null}
                      {credentialState.status === 'ready' ? (
                        <>
                          {selectedSetup.credentials.map((field) => {
                            const status = credentialState.values[field.ref]
                            const configured = status?.configured === true
                            return (
                              <label key={field.ref}>
                                <span>
                                  <strong>{t(field.labelKey)}</strong>
                                  <em data-configured={configured || undefined}>
                                    {t(configured ? 'presetCredentialConfigured' : 'presetCredentialMissing')}
                                  </em>
                                </span>
                                <input
                                  type={field.secret ? 'password' : 'text'}
                                  autoComplete="off"
                                  value={credentialInputs[field.ref] ?? ''}
                                  disabled={savingCredentials || status?.writable === false}
                                  placeholder={t(configured
                                    ? 'presetCredentialReplacePlaceholder'
                                    : 'presetCredentialInputPlaceholder')}
                                  aria-label={t(field.labelKey)}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value
                                    setCredentialInputs(current => ({ ...current, [field.ref]: value }))
                                    setCredentialFeedback(null)
                                  }}
                                />
                                {status?.source === 'env' ? <small>{t('presetCredentialEnvironment')}</small> : null}
                              </label>
                            )
                          })}
                          <button
                            type="button"
                            className={css.secondaryWide}
                            disabled={savingCredentials
                              || selectedSetup.credentials.every(field => (credentialInputs[field.ref]?.trim() ?? '') === '')
                              || selectedSetup.credentials.some(field => (
                                credentialState.values[field.ref]?.configured !== true
                                && (credentialInputs[field.ref]?.trim() ?? '') === ''
                              ))}
                            onClick={saveCredentials}
                          >
                            {savingCredentials ? t('presetCredentialSaving') : t('presetCredentialSave')}
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
              <dl className={css.metadata}>
                <div><dt>{t('publisher')}</dt><dd>@{selectedItem.publisher.username}</dd></div>
                <div><dt>{t('presetId')}</dt><dd><code>{selectedItem.presetId}</code></dd></div>
                <div><dt>{t('presetDownloads')}</dt><dd>{selectedItem.downloadCount.toLocaleString()}</dd></div>
                <div><dt>{t('presetCreated')}</dt><dd>{new Date(selectedItem.createdAt).toLocaleDateString()}</dd></div>
                <div><dt>{t('presetPackageSize')}</dt><dd>{formatBytes(selectedItem.artifact.sizeBytes)}</dd></div>
                <div><dt>{t('presetSourceVersion')}</dt><dd>{selectedItem.artifact.sourceDshVersion}</dd></div>
              </dl>
              <div className={css.securityNotice}>
                <strong>{t('presetSecurityTitle')}</strong>
                <p>{t('presetSecurityWarning')}</p>
              </div>

              {selectedInstalled !== undefined ? (
                <>
                  {selectedInstalled.broken === undefined ? null : (
                    <p className={css.failureText} role="alert">{t('presetBroken')}</p>
                  )}
                  <button
                    type="button"
                    className={css.primaryWide}
                    disabled={!presetMutationsEnabled || selectedInstalled.broken !== undefined
                      || runtimeInstallTarget === selectedSetup?.runtimeId}
                    onClick={() => { usePreset(selectedInstalled.id) }}
                  >
                    {t(actionKeyForInstalled(selectedSetup))}
                  </button>
                </>
              ) : local.status === 'loading' ? (
                <p className={css.status}>{t('presetLoading')}</p>
              ) : local.status === 'error' ? (
                <div className={css.failure} role="alert">
                  <span>{t('presetLocalError')}</span>
                  <button type="button" onClick={() => { setLocalRevision(value => value + 1) }}>{t('retry')}</button>
                </div>
              ) : (
                <>
                  {preview.status === 'idle' ? (
                    <button
                      type="button"
                      className={css.primaryWide}
                      disabled={!presetMutationsEnabled}
                      onClick={() => { startPreview(selectedItem) }}
                    >
                      {t('presetPreview')}
                    </button>
                  ) : null}
                  {preview.status === 'loading' ? <p className={css.status}>{t('presetPreviewing')}</p> : null}
                  {preview.status === 'error' ? (
                    <div className={css.failure} role="alert">
                      <span>{t('presetInstallFailed')}</span>
                      <button type="button" onClick={() => { startPreview(selectedItem, targetId || null) }}>{t('retry')}</button>
                    </div>
                  ) : null}
                  {preview.status === 'ready' ? (
                    <div className={css.preview}>
                      <label>
                        <span>{t('presetTargetId')}</span>
                        <input
                          type="text"
                          value={targetId}
                          disabled={installing}
                          onChange={(event) => {
                            setTargetId(event.currentTarget.value)
                            setAcknowledged(false)
                          }}
                        />
                      </label>
                      <div className={css.previewFacts}>
                        <span>{t('presetFiles')}: {preview.value.fileCount}</span>
                        <span>{formatBytes(selectedItem.artifact.sizeBytes)}</span>
                      </div>
                      {preview.value.warnings.length === 0 ? null : (
                        <ul className={css.warnings}>
                          {preview.value.warnings.map(warning => <li key={warning}>{t(WARNING_KEYS[warning])}</li>)}
                        </ul>
                      )}
                      {preview.value.conflict ? <p className={css.conflict} role="alert">{t('presetConflict')}</p> : null}
                      {targetId !== preview.value.targetId ? (
                        <button
                          type="button"
                          className={css.secondaryWide}
                          disabled={installing || targetId.trim() === ''}
                          onClick={() => { startPreview(selectedItem, targetId.trim()) }}
                        >
                          {t('presetPreview')}
                        </button>
                      ) : null}
                      <label className={css.acknowledge}>
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          disabled={installing || preview.value.conflict || targetId !== preview.value.targetId}
                          onChange={(event) => { setAcknowledged(event.currentTarget.checked) }}
                        />
                        <span>{t('presetTrustAcknowledge')}</span>
                      </label>
                      <button
                        type="button"
                        className={css.primaryWide}
                        disabled={installing || !acknowledged || preview.value.conflict || targetId !== preview.value.targetId}
                        onClick={confirmInstall}
                      >
                        {installing ? t('presetInstalling') : t('confirmInstall')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {removeTarget === null ? null : (
        <div className={css.overlay} role="presentation">
          <section className={`${css.dialog} ${css.confirmDialog}`} role="dialog" aria-modal="true" aria-labelledby="preset-remove-title">
            <header className={css.dialogHeader}>
              <div>
                <span>{t('presetRemoveTitle')}</span>
                <h2 id="preset-remove-title">{removeTarget.name ?? removeTarget.id}</h2>
              </div>
              <button type="button" aria-label={t('close')} disabled={removing} onClick={() => { setRemoveTarget(null) }}>
                <IconCloseOutline16 size={16} />
              </button>
            </header>
            <div className={css.dialogBody}>
              <p className={css.description}>{t('presetRemoveWarning')}</p>
              <div className={css.confirmActions}>
                <button type="button" disabled={removing} onClick={() => { setRemoveTarget(null) }}>{t('cancel')}</button>
                <button type="button" className={css.dangerSolid} disabled={removing} onClick={confirmRemove}>
                  {removing ? t('presetRemoving') : t('presetRemove')}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
