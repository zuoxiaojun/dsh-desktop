import { describe, expect, it } from 'vitest'
import {
  CatalogContractError,
  decodePresetInstallPreviewRequest,
  decodePresetInstallPreviewResult,
  decodePresetInstallRequest,
  decodePresetRuntimeRequest,
  decodePresetSquareDetailQuery,
  decodePresetSquareListQuery,
  decodePresetSquareListResponse,
} from '../src/index.ts'

const ITEM = {
  id: 'b4084c61-633d-43af-b382-828d03f22bd5',
  slug: 'preset-0f6298',
  presetId: 'image-production-zh-mode',
  title: '图像制作模式',
  description: '完成可复现、保留来源的图像生产流程。',
  publisher: { username: 'dshdesktop' },
  artifact: {
    downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/preset-0f6298/download',
    sha256: '1f5d9993adc61de76ac073a8262449f37f903e63696579b2467164f98552d310',
    sizeBytes: 11_556,
    formatVersion: 1,
    sourceDshVersion: '0.1.0-rc.6',
  },
  detailUrl: 'https://www.dshdesktop.com/preset/p/preset-0f6298',
  downloadCount: 245,
  visualVariant: 1,
  createdAt: '2026-08-15T03:35:34.361Z',
} as const

describe('Preset Square contracts', () => {
  it('decodes the live list shape and closed renderer intents', () => {
    expect(decodePresetSquareListResponse({ items: [ITEM], total: 1, sort: 'downloads' }))
      .toEqual({ items: [{ ...ITEM, source: 'community' }], total: 1, sort: 'downloads' })
    expect(decodePresetSquareListQuery({ query: '图像', sort: 'downloads' }))
      .toEqual({ query: '图像', sort: 'downloads' })
    expect(decodePresetSquareDetailQuery({ slug: ITEM.slug })).toEqual({ slug: ITEM.slug })
    expect(decodePresetInstallPreviewRequest({ slug: ITEM.slug, targetId: null }))
      .toEqual({ slug: ITEM.slug, targetId: null })
    expect(decodePresetInstallRequest({ slug: ITEM.slug, targetId: ITEM.presetId }))
      .toEqual({ slug: ITEM.slug, targetId: ITEM.presetId })
    expect(decodePresetRuntimeRequest({ presetId: 'product-video-director' }))
      .toEqual({ presetId: 'product-video-director' })
    expect(decodePresetSquareListResponse({
      items: [{
        ...ITEM,
        artifact: { ...ITEM.artifact, downloadUrl: ITEM.artifact.downloadUrl.replace('www.', '') },
        detailUrl: ITEM.detailUrl.replace('www.', ''),
      }],
      total: 1,
      sort: 'downloads',
    }).items[0]).toMatchObject({ slug: ITEM.slug, source: 'community' })
  })

  it('preserves the first-party catalog provenance without changing local trust', () => {
    expect(decodePresetSquareListResponse({
      items: [{ ...ITEM, source: 'fufan-official' }],
      total: 1,
      sort: 'newest',
    }).items[0]?.source).toBe('fufan-official')
    expect(() => decodePresetSquareListResponse({
      items: [{ ...ITEM, source: 'official' }],
      total: 1,
      sort: 'newest',
    })).toThrow(CatalogContractError)
  })

  it('decodes a bounded executable-config preview', () => {
    const preview = {
      slug: ITEM.slug,
      title: ITEM.title,
      targetId: ITEM.presetId,
      sourcePresetId: ITEM.presetId,
      name: ITEM.title,
      description: ITEM.description,
      sourceDshVersion: '0.1.0-rc.6',
      fileCount: 9,
      warnings: ['absolute-paths'],
      conflict: false,
    }
    expect(decodePresetInstallPreviewResult(preview)).toEqual(preview)
  })

  it.each([
    ['unknown list field', { items: [ITEM], total: 1, sort: 'downloads', next: 'cursor' }],
    ['arbitrary download origin', { items: [{ ...ITEM, artifact: { ...ITEM.artifact, downloadUrl: 'https://evil.example/a.zip' } }], total: 1, sort: 'downloads' }],
    ['mismatched download slug', { items: [{ ...ITEM, artifact: { ...ITEM.artifact, downloadUrl: 'https://www.dshdesktop.com/preset/api/v1/presets/other/download' } }], total: 1, sort: 'downloads' }],
    ['wrong detail path', { items: [{ ...ITEM, detailUrl: 'https://www.dshdesktop.com/preset/p/other' }], total: 1, sort: 'downloads' }],
    ['oversized artifact', { items: [{ ...ITEM, artifact: { ...ITEM.artifact, sizeBytes: 17 * 1024 * 1024 } }], total: 1, sort: 'downloads' }],
  ])('rejects %s', (_name, value) => {
    expect(() => decodePresetSquareListResponse(value)).toThrow(CatalogContractError)
  })

  it('rejects renderer-supplied package authority and invalid ids', () => {
    expect(() => decodePresetInstallRequest({
      slug: ITEM.slug,
      targetId: ITEM.presetId,
      downloadUrl: ITEM.artifact.downloadUrl,
    })).toThrow(CatalogContractError)
    expect(() => decodePresetInstallPreviewRequest({ slug: ITEM.slug, targetId: '../escape' }))
      .toThrow(CatalogContractError)
    expect(() => decodePresetRuntimeRequest({ presetId: 'arbitrary-preset' }))
      .toThrow(CatalogContractError)
    expect(() => decodePresetRuntimeRequest({
      presetId: 'product-video-director', packages: ['evil-package'],
    })).toThrow(CatalogContractError)
  })
})
