// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PresetSquareItem } from '@deepseek-ai/dsh-plugin-center-contracts'
import {
  PresetSquarePanel, type LocalPresetEntry, type PresetSquareInjected,
} from '../src/client/PresetSquarePanel.tsx'
import { zh, type PluginCenterLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: PluginCenterLocaleKey): string => zh[key]

const ITEM = {
  id: '17d84963-a192-4d25-b918-0d454bc3da4e',
  slug: 'web-research-assistant',
  presetId: 'web-research-assistant',
  title: '网页研究助手',
  description: '组合浏览器、检索与信息整理能力。',
  source: 'community',
  publisher: { username: 'dsh-community' },
  artifact: {
    downloadUrl: 'https://www.dshdesktop.com/preset/download/web-research-assistant.dshpreset',
    sha256: 'a'.repeat(64),
    sizeBytes: 48_320,
    formatVersion: 1,
    sourceDshVersion: '0.1.0-rc.5',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/web-research-assistant',
  downloadCount: 2_418,
  visualVariant: 2,
  createdAt: '2026-08-12T08:00:00.000Z',
} as const satisfies PresetSquareItem

const OFFICIAL_ITEM = {
  ...ITEM,
  id: 'fufan-case-01-ai-webapp',
  slug: 'fufan-ai-webapp',
  presetId: 'ai-product-developer',
  title: 'AI WebApp',
  description: '1 套 Agent Preset + 3 个 Skills。',
  source: 'fufan-official',
  publisher: { username: '赋范官方' },
  artifact: {
    ...ITEM.artifact,
    downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/fufan-ai-webapp/download',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/p/fufan-ai-webapp',
} as const satisfies PresetSquareItem

const FEISHU_ITEM = {
  ...OFFICIAL_ITEM,
  id: 'fufan-case-06-feishu-digital-employee',
  slug: 'fufan-feishu-digital-employee',
  presetId: 'feishu-digital-employee',
  title: '飞书数字员工',
  description: '1 套 Agent Preset + 1 个 Skill，并接入飞书 MCP 与时间解析 MCP。',
  visualVariant: 5,
  artifact: {
    ...OFFICIAL_ITEM.artifact,
    downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/fufan-feishu-digital-employee/download',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/p/fufan-feishu-digital-employee',
} as const satisfies PresetSquareItem

const LLM_WIKI_ITEM = {
  ...OFFICIAL_ITEM,
  id: 'fufan-case-07-llm-wiki-producer',
  slug: 'fufan-llm-wiki-producer',
  presetId: 'llm-wiki-fullstack',
  title: 'LLM Wiki Producer',
  description: '面向企业知识库项目按阶段完成开发、验证与交付。',
  visualVariant: 6,
  artifact: {
    ...OFFICIAL_ITEM.artifact,
    downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/fufan-llm-wiki-producer/download',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/p/fufan-llm-wiki-producer',
} as const satisfies PresetSquareItem

const VIDEO_ITEM = {
  ...OFFICIAL_ITEM,
  id: 'fufan-case-03-video-generation',
  slug: 'fufan-video-generation',
  presetId: 'product-video-director',
  title: '视频生成',
  description: '1 套 Agent Preset + 1 个 Skill，从调研、分镜到 HyperFrames MP4。',
  artifact: {
    ...OFFICIAL_ITEM.artifact,
    downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/fufan-video-generation/download',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/p/fufan-video-generation',
} as const satisfies PresetSquareItem

const OFFICIAL_ARTWORK_ITEMS = [
  OFFICIAL_ITEM,
  {
    ...OFFICIAL_ITEM,
    id: 'fufan-case-02-ppt-office',
    slug: 'fufan-ppt-office',
    presetId: 'dsh-motion-deck-studio',
    title: 'PPT Office',
    visualVariant: 1,
  },
  VIDEO_ITEM,
  {
    ...OFFICIAL_ITEM,
    id: 'fufan-case-04-content-factory',
    slug: 'fufan-content-factory',
    presetId: 'ai-content-image-studio',
    title: '内容工厂',
    visualVariant: 3,
  },
  {
    ...OFFICIAL_ITEM,
    id: 'fufan-case-05-ai-report',
    slug: 'fufan-ai-report',
    presetId: 'ai-report-analyst',
    title: 'AI 报表',
    visualVariant: 4,
  },
  FEISHU_ITEM,
  LLM_WIKI_ITEM,
] as const satisfies readonly PresetSquareItem[]

function props(values: Partial<PresetSquareInjected> = {}): PresetSquareInjected {
  return {
    presetAvailable: true,
    presetDevelopment: false,
    presetMutationsEnabled: true,
    listPresetSquare: async () => ({
      items: [ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
    }),
    detailPresetSquare: async () => ({ item: ITEM, fetchedAt: '2026-08-17T08:00:00.000Z' }),
    previewPresetInstall: async request => ({
      slug: request.slug,
      title: ITEM.title,
      targetId: request.targetId ?? ITEM.presetId,
      sourcePresetId: ITEM.presetId,
      name: ITEM.title,
      description: ITEM.description,
      sourceDshVersion: ITEM.artifact.sourceDshVersion,
      fileCount: 3,
      warnings: [],
      conflict: false,
    }),
    installPreset: async request => ({
      slug: request.slug,
      title: ITEM.title,
      targetId: request.targetId,
      sourcePresetId: ITEM.presetId,
      name: ITEM.title,
      description: ITEM.description,
      sourceDshVersion: ITEM.artifact.sourceDshVersion,
      fileCount: 3,
      warnings: [],
      conflict: false,
      installed: true,
    }),
    checkPresetRuntime: async presetId => ({
      presetId,
      phase: 'ready',
      dependencies: [],
      canInstall: false,
      revision: 1,
      updatedAt: '2026-08-17T08:00:00.000Z',
    }),
    installPresetRuntime: async presetId => ({
      presetId,
      phase: 'ready',
      dependencies: [],
      canInstall: false,
      revision: 2,
      updatedAt: '2026-08-17T08:00:01.000Z',
    }),
    listLocalPresets: async () => ({ presets: [], authorable: true }),
    removeLocalPreset: async () => {},
    describePresetCredentials: async refs => Object.fromEntries(refs.map(ref => [ref, {
      configured: false, writable: true,
    }])),
    setPresetCredential: async () => {},
    useLocalPreset: async () => 'opened',
    ...values,
  }
}

describe('Preset Square shared surface', () => {
  it('defaults to 赋范官方, switches sources as tabs, and renders semantic SVG artwork', async () => {
    const { container } = render(<PresetSquarePanel {...props({
      listPresetSquare: async () => ({
        items: [...OFFICIAL_ARTWORK_ITEMS, ITEM], total: 8, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      detailPresetSquare: async query => ({
        item: OFFICIAL_ARTWORK_ITEMS.find(item => item.slug === query.slug) ?? ITEM,
        fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
    })} t={t} />)

    expect((await screen.findByRole('tab', {
      name: new RegExp(zh.presetFufanOfficialTitle),
    })).getAttribute('aria-selected')).toBe('true')
    const llmWikiCard = (await screen.findByText(LLM_WIKI_ITEM.title)).closest('article')
    if (llmWikiCard === null) throw new Error('LLM Wiki Producer 卡片未渲染')
    const officialCards = container.querySelectorAll('[data-layout="grid"] article')
    expect(officialCards.item(0).textContent).toContain(LLM_WIKI_ITEM.title)

    const officialCard = screen.getByText(OFFICIAL_ITEM.title).closest('article')
    if (officialCard === null) throw new Error('赋范官方卡片未渲染')
    expect(within(officialCard).getByText(zh.presetFufanOfficialBadge)).toBeTruthy()
    for (const item of OFFICIAL_ARTWORK_ITEMS) {
      expect(container.querySelector(`[data-artwork="${item.presetId}"] svg`)).toBeTruthy()
    }
    expect(llmWikiCard.querySelector('[data-variant="6"]')).toBeTruthy()
    expect(screen.queryByText(ITEM.title)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh.presetListView }))
    expect(screen.getByRole('button', { name: zh.presetListView }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-layout="list"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.presetGridView }))
    expect(container.querySelector('[data-layout="grid"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(zh.presetCommunityTitle) }))
    const communityCard = (await screen.findByText(ITEM.title)).closest('article')
    if (communityCard === null) throw new Error('社区卡片未渲染')
    expect(communityCard.querySelector('[data-artwork="community-fallback"] svg')).toBeTruthy()
    expect(screen.queryByText(OFFICIAL_ITEM.title)).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(zh.presetFufanOfficialTitle) }))
    const restoredOfficialCard = (await screen.findByText(OFFICIAL_ITEM.title)).closest('article')
    if (restoredOfficialCard === null) throw new Error('赋范官方卡片未恢复')
    fireEvent.click(within(restoredOfficialCard).getByRole('button', { name: zh.details }))
    const officialDialog = await screen.findByRole('dialog', { name: OFFICIAL_ITEM.title })
    expect(within(officialDialog).getByText(zh.presetFufanOfficialDisclaimer)).toBeTruthy()
    fireEvent.click(within(officialDialog).getByRole('button', { name: zh.close }))

    const restoredLlmWikiCard = screen.getByText(LLM_WIKI_ITEM.title).closest('article')
    if (restoredLlmWikiCard === null) throw new Error('LLM Wiki Producer 卡片未恢复')
    fireEvent.click(within(restoredLlmWikiCard).getByRole('button', { name: zh.details }))
    const llmWikiDialog = await screen.findByRole('dialog', { name: LLM_WIKI_ITEM.title })
    expect(within(llmWikiDialog).getByText(zh.presetCapabilitiesTitle)).toBeTruthy()
    expect(within(llmWikiDialog).getByText(zh.presetLlmWikiAgent)).toBeTruthy()
    expect(within(llmWikiDialog).getByText(zh.presetLlmWikiSkills)).toBeTruthy()
    expect(within(llmWikiDialog).getByText(zh.presetLlmWikiTools)).toBeTruthy()
    expect(within(llmWikiDialog).getByText(zh.presetLlmWikiRuntime)).toBeTruthy()
  })

  it('filters the complete fetched list locally and keeps server sorting explicit', async () => {
    const listPresetSquare = vi.fn<PresetSquareInjected['listPresetSquare']>(async query => ({
      items: [ITEM],
      total: 1,
      sort: query.sort,
      fetchedAt: `2026-08-17T08:00:0${query.sort === 'downloads' ? '0' : '1'}.000Z`,
    }))
    render(<PresetSquarePanel {...props({ listPresetSquare })} t={t} />)

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(zh.presetCommunityTitle) }))
    expect(await screen.findByText(ITEM.title)).toBeTruthy()
    expect(listPresetSquare).toHaveBeenCalledWith({ query: '', sort: 'downloads' })
    fireEvent.change(screen.getByRole('searchbox', { name: zh.presetSearch }), { target: { value: '不存在' } })
    expect(screen.getByText(zh.presetEmpty)).toBeTruthy()
    expect(listPresetSquare).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: zh.presetSortNewest }))
    await waitFor(() => { expect(listPresetSquare).toHaveBeenLastCalledWith({ query: '', sort: 'newest' }) })
  })

  it('uses an already installed Preset from details instead of offering a conflicting reinstall', async () => {
    const previewPresetInstall = vi.fn<PresetSquareInjected['previewPresetInstall']>()
    const useLocalPreset = vi.fn<PresetSquareInjected['useLocalPreset']>(async () => 'opened')
    render(<PresetSquarePanel {...props({
      listPresetSquare: async () => ({
        items: [LLM_WIKI_ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      detailPresetSquare: async () => ({
        item: LLM_WIKI_ITEM, fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      listLocalPresets: async () => ({
        presets: [{ id: LLM_WIKI_ITEM.presetId, trust: 'user', isDefault: false }], authorable: true,
      }),
      previewPresetInstall,
      useLocalPreset,
    })} t={t} />)

    const card = (await screen.findByText(LLM_WIKI_ITEM.title)).closest('article')
    if (card === null) throw new Error('LLM Wiki Producer 卡片未渲染')
    fireEvent.click(within(card).getByRole('button', { name: zh.details }))

    const dialog = await screen.findByRole('dialog', { name: LLM_WIKI_ITEM.title })
    expect(within(dialog).queryByLabelText(zh.presetTargetId)).toBeNull()
    expect(within(dialog).queryByText(zh.presetConflict)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.presetUse }))

    await waitFor(() => { expect(useLocalPreset).toHaveBeenCalledWith(LLM_WIKI_ITEM.presetId) })
    expect(previewPresetInstall).not.toHaveBeenCalled()
  })

  it('previews, confirms, installs, and refreshes the local roster without leaving the page', async () => {
    let installed = false
    const previewPresetInstall = vi.fn<PresetSquareInjected['previewPresetInstall']>(async request => ({
      slug: request.slug,
      title: ITEM.title,
      targetId: request.targetId ?? ITEM.presetId,
      sourcePresetId: ITEM.presetId,
      name: ITEM.title,
      description: ITEM.description,
      sourceDshVersion: ITEM.artifact.sourceDshVersion,
      fileCount: 3,
      warnings: ['version-mismatch'],
      conflict: false,
    }))
    const installPreset = vi.fn<PresetSquareInjected['installPreset']>(async (request) => {
      installed = true
      return {
        slug: request.slug,
        title: ITEM.title,
        targetId: request.targetId,
        sourcePresetId: ITEM.presetId,
        name: ITEM.title,
        description: ITEM.description,
        sourceDshVersion: ITEM.artifact.sourceDshVersion,
        fileCount: 3,
        warnings: ['version-mismatch'],
        conflict: false,
        installed: true,
      }
    })
    const listLocalPresets = vi.fn(async () => ({
      presets: installed ? [{ id: ITEM.presetId, trust: 'user' as const, isDefault: false }] : [],
      authorable: true,
    }))
    render(<PresetSquarePanel
      {...props({ previewPresetInstall, installPreset, listLocalPresets })}
      t={t}
    />)

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(zh.presetCommunityTitle) }))
    fireEvent.click(await screen.findByRole('button', { name: zh.install }))
    const dialog = await screen.findByRole('dialog', { name: ITEM.title })
    expect(await within(dialog).findByText(zh.presetWarningVersion)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: zh.presetTrustAcknowledge }))
    fireEvent.click(within(dialog).getByRole('button', { name: zh.confirmInstall }))

    await waitFor(() => { expect(installPreset).toHaveBeenCalledWith({ slug: ITEM.slug, targetId: ITEM.presetId }) })
    expect(await screen.findByText(zh.presetInstallSuccess)).toBeTruthy()
    expect(screen.getByRole('heading', { name: zh.presetTitle })).toBeTruthy()
    expect(listLocalPresets.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('explains Feishu prerequisites and saves all required credentials without echoing values', async () => {
    const configured = new Set<string>()
    const describePresetCredentials = vi.fn<PresetSquareInjected['describePresetCredentials']>(async refs => (
      Object.fromEntries(refs.map(ref => [ref, { configured: configured.has(ref), writable: true }]))
    ))
    const setPresetCredential = vi.fn<PresetSquareInjected['setPresetCredential']>(async (ref) => {
      configured.add(ref)
    })
    render(<PresetSquarePanel {...props({
      listPresetSquare: async () => ({
        items: [FEISHU_ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      detailPresetSquare: async () => ({ item: FEISHU_ITEM, fetchedAt: '2026-08-17T08:00:00.000Z' }),
      describePresetCredentials,
      setPresetCredential,
    })} t={t} />)

    const card = (await screen.findByText(FEISHU_ITEM.title)).closest('article')
    if (card === null) throw new Error('飞书 Preset 卡片未渲染')
    expect(within(card).getByText(zh.presetSetupCredentials)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: zh.details }))
    const dialog = await screen.findByRole('dialog', { name: FEISHU_ITEM.title })
    expect(within(dialog).getByText(zh.presetSetupFeishuDetail)).toBeTruthy()
    await waitFor(() => { expect(describePresetCredentials).toHaveBeenCalled() })

    fireEvent.change(within(dialog).getByLabelText(zh.presetFeishuAppId), { target: { value: 'cli_app' } })
    fireEvent.change(within(dialog).getByLabelText(zh.presetFeishuAppSecret), { target: { value: 'secret-value' } })
    fireEvent.change(within(dialog).getByLabelText(zh.presetFeishuDefaultOpenId), { target: { value: 'ou_user' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.presetCredentialSave }))

    await waitFor(() => { expect(setPresetCredential).toHaveBeenCalledTimes(3) })
    expect(await within(dialog).findByText(zh.presetCredentialSaved)).toBeTruthy()
    expect(within(dialog).getAllByText(zh.presetCredentialConfigured)).toHaveLength(3)
    expect(within(dialog).getByLabelText(zh.presetFeishuAppSecret)).toHaveProperty('value', '')
  })

  it('opens the setup details instead of starting an installed Feishu preset with missing credentials', async () => {
    const useLocalPreset = vi.fn<PresetSquareInjected['useLocalPreset']>(async () => 'opened')
    render(<PresetSquarePanel {...props({
      listPresetSquare: async () => ({
        items: [FEISHU_ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      detailPresetSquare: async () => ({ item: FEISHU_ITEM, fetchedAt: '2026-08-17T08:00:00.000Z' }),
      listLocalPresets: async () => ({
        presets: [{ id: FEISHU_ITEM.presetId, trust: 'user', isDefault: false }], authorable: true,
      }),
      useLocalPreset,
    })} t={t} />)

    fireEvent.click(await screen.findByRole('button', { name: zh.presetUse }))
    const dialog = await screen.findByRole('dialog', { name: FEISHU_ITEM.title })
    expect(within(dialog).getByText(zh.presetSetupRequired)).toBeTruthy()
    expect(useLocalPreset).not.toHaveBeenCalled()
  })

  it('detects, confirms, installs, and rechecks an installed managed Preset runtime before use', async () => {
    let ready = false
    let revision = 1
    const runtimeSnapshot = () => ({
      presetId: 'product-video-director' as const,
      phase: ready ? 'ready' as const : 'missing' as const,
      dependencies: [
        { id: 'node' as const, state: 'ready' as const, installable: true, version: 'v24.0.0' },
        {
          id: 'hyperframes' as const,
          state: ready ? 'ready' as const : 'missing' as const,
          installable: true,
          version: ready ? '0.7.109' : null,
        },
      ],
      canInstall: !ready,
      revision: revision++,
      updatedAt: '2026-08-17T08:00:00.000Z',
    })
    const checkPresetRuntime = vi.fn<PresetSquareInjected['checkPresetRuntime']>(async presetId => (
      presetId === 'product-video-director'
        ? runtimeSnapshot()
        : {
          presetId,
          phase: 'ready',
          dependencies: [],
          canInstall: false,
          revision: revision++,
          updatedAt: '2026-08-17T08:00:00.000Z',
        }
    ))
    const installPresetRuntime = vi.fn<PresetSquareInjected['installPresetRuntime']>(async () => {
      ready = true
      return runtimeSnapshot()
    })
    const useLocalPreset = vi.fn<PresetSquareInjected['useLocalPreset']>(async () => 'opened')
    render(<PresetSquarePanel {...props({
      listPresetSquare: async () => ({
        items: [VIDEO_ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
      }),
      detailPresetSquare: async () => ({ item: VIDEO_ITEM, fetchedAt: '2026-08-17T08:00:00.000Z' }),
      listLocalPresets: async () => ({
        presets: [{ id: VIDEO_ITEM.presetId, trust: 'user', isDefault: false }], authorable: true,
      }),
      checkPresetRuntime,
      installPresetRuntime,
      useLocalPreset,
    })} t={t} />)

    const card = (await screen.findByText(VIDEO_ITEM.title)).closest('article')
    if (card === null) throw new Error('视频 Preset 卡片未渲染')
    expect(await within(card).findByText(zh.presetRuntimeRequired)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: zh.presetRuntimeConfigureAction }))

    const dialog = await screen.findByRole('dialog', { name: VIDEO_ITEM.title })
    expect(within(dialog).getByText(zh.presetRuntimeHyperframes)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.presetRuntimeConfirmAction }))
    await waitFor(() => { expect(installPresetRuntime).toHaveBeenCalledWith('product-video-director') })
    expect(await within(dialog).findByText(zh.presetRuntimeReadyDetail)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: zh.close }))

    fireEvent.click(within(card).getByRole('button', { name: zh.presetUse }))
    await waitFor(() => { expect(useLocalPreset).toHaveBeenCalledWith(VIDEO_ITEM.presetId) })
  })

  it('deletes only a user preset and refreshes just the local roster', async () => {
    const entries: LocalPresetEntry[] = [
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'my-preset', trust: 'user', isDefault: false, name: '我的 Preset' },
    ]
    const removeLocalPreset = vi.fn<PresetSquareInjected['removeLocalPreset']>(async (id) => {
      entries.splice(entries.findIndex(item => item.id === id), 1)
    })
    const listLocalPresets = vi.fn(async () => ({ presets: [...entries], authorable: true }))
    const listPresetSquare = vi.fn<PresetSquareInjected['listPresetSquare']>(async () => ({
      items: [ITEM], total: 1, sort: 'downloads', fetchedAt: '2026-08-17T08:00:00.000Z',
    }))
    render(<PresetSquarePanel
      {...props({ removeLocalPreset, listLocalPresets, listPresetSquare })}
      t={t}
    />)

    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(zh.presetInstalledTab) }))
    expect(await screen.findByText('我的 Preset')).toBeTruthy()
    expect(screen.getAllByText(zh.presetProtected)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: zh.presetRemove }))
    const dialog = screen.getByRole('dialog', { name: '我的 Preset' })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.presetRemove }))

    await waitFor(() => { expect(removeLocalPreset).toHaveBeenCalledWith('my-preset') })
    await waitFor(() => { expect(screen.queryByText('我的 Preset')).toBeNull() })
    expect(listPresetSquare).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: zh.presetTitle })).toBeTruthy()
  })
})
