import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PresetSquareClient } from '../src/preset-square/client.ts'

const archive = new TextEncoder().encode('fixture-preset-archive')
const ITEM = {
  id: 'b4084c61-633d-43af-b382-828d03f22bd5',
  slug: 'preset-0f6298',
  presetId: 'image-production-zh-mode',
  title: '图像制作模式',
  description: '完成可复现、保留来源的图像生产流程。',
  source: 'community',
  publisher: { username: 'dshdesktop' },
  artifact: {
    downloadUrl: 'https://dshdesktop.com/preset/api/v1/presets/preset-0f6298/download',
    sha256: createHash('sha256').update(archive).digest('hex'),
    sizeBytes: archive.length,
    formatVersion: 1,
    sourceDshVersion: '0.1.0-rc.6',
  },
  detailUrl: 'https://dshdesktop.com/preset/p/preset-0f6298',
  downloadCount: 245,
  visualVariant: 1,
  createdAt: '2026-08-15T03:35:34.361Z',
} as const

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function hostPreview(installed: boolean): Response {
  return json({
    ok: true,
    targetId: ITEM.presetId,
    sourcePresetId: ITEM.presetId,
    name: ITEM.title,
    description: ITEM.description,
    sourceDshVersion: ITEM.artifact.sourceDshVersion,
    fileCount: 9,
    warnings: [],
    conflict: false,
    installed,
  })
}

describe('Desktop Preset Square client', () => {
  it('lists, searches, previews and installs only through fixed authorities', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.origin === 'http://127.0.0.1:4321') return hostPreview(url.searchParams.get('install') === '1')
      if (url.pathname.endsWith('/download')) {
        return new Response(archive, { headers: { 'content-length': String(archive.length) } })
      }
      if (url.pathname.endsWith(`/${ITEM.slug}`)) return json(ITEM)
      expect(init?.redirect).toBe('error')
      return json({ items: [ITEM], total: 1, sort: 'downloads' })
    })
    const client = new PresetSquareClient(fetcher, () => Date.parse('2026-08-17T00:00:00.000Z'), () => 'http://127.0.0.1:4321')
    await expect(client.list({ query: '图像', sort: 'downloads' })).resolves.toMatchObject({ items: [ITEM] })
    await expect(client.previewInstall({ slug: ITEM.slug, targetId: null })).resolves.toMatchObject({
      slug: ITEM.slug, targetId: ITEM.presetId, conflict: false,
    })
    await expect(client.install({ slug: ITEM.slug, targetId: ITEM.presetId })).resolves.toMatchObject({
      slug: ITEM.slug, targetId: ITEM.presetId, installed: true,
    })
  })

  it('rejects a digest mismatch before contacting the local Host', async () => {
    const bad = { ...ITEM, artifact: { ...ITEM.artifact, sha256: 'f'.repeat(64) } }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      return url.pathname.endsWith('/download') ? new Response(archive) : json(bad)
    })
    const client = new PresetSquareClient(fetcher, Date.now, () => 'http://127.0.0.1:4321')
    await expect(client.previewInstall({ slug: ITEM.slug, targetId: null })).rejects.toThrow('SHA-256')
    expect(fetcher.mock.calls.some(([input]) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      return url.includes('127.0.0.1')
    })).toBe(false)
  })

  it('rejects renderer package authority and a manifest identity mismatch', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.origin === 'http://127.0.0.1:4321') {
        const response = hostPreview(false)
        const body = await response.json() as Record<string, unknown>
        return json({ ...body, sourcePresetId: 'another-preset' })
      }
      return url.pathname.endsWith('/download') ? new Response(archive) : json(ITEM)
    })
    const client = new PresetSquareClient(fetcher, Date.now, () => 'http://127.0.0.1:4321')
    await expect(client.previewInstall({
      slug: ITEM.slug,
      targetId: null,
      downloadUrl: ITEM.artifact.downloadUrl,
    })).rejects.toThrow()
    await expect(client.previewInstall({ slug: ITEM.slug, targetId: null })).rejects.toThrow('manifest')
  })

  it('keeps bundled first-party entries available and installable when the community service is offline', async () => {
    const official = { ...ITEM, source: 'fufan-official' as const, publisher: { username: '赋范官方' } }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.origin === 'http://127.0.0.1:4321') return hostPreview(false)
      throw new Error('community offline')
    })
    const client = new PresetSquareClient(
      fetcher,
      () => Date.parse('2026-08-17T00:00:00.000Z'),
      () => 'http://127.0.0.1:4321',
      {
        list: async () => [official],
        detail: async slug => slug === official.slug ? official : undefined,
        archive: async slug => slug === official.slug ? archive : undefined,
      },
    )

    await expect(client.list({ query: '赋范', sort: 'downloads' })).resolves.toMatchObject({
      items: [{ source: 'fufan-official' }],
      total: 1,
    })
    await expect(client.previewInstall({ slug: official.slug, targetId: null })).resolves.toMatchObject({
      sourcePresetId: official.presetId,
    })
  })
})
