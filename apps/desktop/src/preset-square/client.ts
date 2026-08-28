/** Fixed-origin Preset Square reader and integrity-checked Host importer. */

import { createHash } from 'node:crypto'
import {
  decodePresetInstallPreviewRequest,
  decodePresetInstallPreviewResult,
  decodePresetInstallRequest,
  decodePresetInstallResult,
  decodePresetSquareDetailQuery,
  decodePresetSquareDetailResult,
  decodePresetSquareItem,
  decodePresetSquareListQuery,
  decodePresetSquareListResponse,
  decodePresetSquareListResult,
  type PresetInstallPreviewResult,
  type PresetInstallResult,
  type PresetSquareItem,
} from '@deepseek-ai/dsh-plugin-center-contracts'
import {
  EMPTY_PRESET_SQUARE_CATALOG,
  type PresetSquareBundledCatalog,
} from './bundled-catalog.ts'

const PRESET_SQUARE_ORIGIN = 'https://www.dshdesktop.com'
const PRESET_SQUARE_ALLOWED_ORIGINS = new Set([
  PRESET_SQUARE_ORIGIN,
  'https://dshdesktop.com',
])
const PRESET_SQUARE_ROOT = `${PRESET_SQUARE_ORIGIN}/preset/`
const MAX_METADATA_BYTES = 512 * 1024
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000

function assertSquareUrl(url: URL): void {
  if (url.protocol !== 'https:' || !PRESET_SQUARE_ALLOWED_ORIGINS.has(url.origin)
    || !url.pathname.startsWith('/preset/')) {
    throw new Error('Preset Square request left the fixed HTTPS origin')
  }
}

function responseLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length')
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Preset Square returned an invalid Content-Length')
  return value
}

function responseUrl(response: Response): URL | undefined {
  if (response.url.length === 0) return undefined
  const url = new URL(response.url)
  assertSquareUrl(url)
  return url
}

function matchesSearch(item: PresetSquareItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  return [item.title, item.description, item.presetId, item.publisher.username]
    .some(value => value.toLocaleLowerCase().includes(needle))
}

/** Desktop-owned Preset Square operations; no renderer value supplies package authority. */
export class PresetSquareClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly hostOrigin: () => string | undefined,
    private readonly bundled: PresetSquareBundledCatalog = EMPTY_PRESET_SQUARE_CATALOG,
  ) {}

  async list(value: unknown) {
    const query = decodePresetSquareListQuery(value)
    const url = new URL('api/v1/presets', PRESET_SQUARE_ROOT)
    url.searchParams.set('sort', query.sort)
    const bundled = [...await this.bundled.list()]
    if (query.sort === 'newest') {
      bundled.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    }
    const body = await this.readJson(url).then(decodePresetSquareListResponse).catch((error: unknown) => {
      if (bundled.length === 0) throw error
      return undefined
    })
    const community = body?.items.map(item => ({ ...item, source: 'community' as const })) ?? []
    const items = [...bundled, ...community]
    return decodePresetSquareListResult({
      items: items.filter(item => matchesSearch(item, query.query)),
      total: items.length,
      sort: query.sort,
      fetchedAt: new Date(this.now()).toISOString(),
    })
  }

  async detail(value: unknown) {
    const query = decodePresetSquareDetailQuery(value)
    const bundled = await this.bundled.detail(query.slug)
    if (bundled !== undefined) {
      return decodePresetSquareDetailResult({ item: bundled, fetchedAt: new Date(this.now()).toISOString() })
    }
    const url = new URL(`api/v1/presets/${encodeURIComponent(query.slug)}`, PRESET_SQUARE_ROOT)
    const response = await this.fetchResponse(url)
    if (response.status === 404) {
      return decodePresetSquareDetailResult({ item: null, fetchedAt: new Date(this.now()).toISOString() })
    }
    const item = { ...decodePresetSquareItem(await this.readJsonResponse(response, url)), source: 'community' as const }
    if (item.slug !== query.slug) throw new Error('Preset Square detail returned a different slug')
    return decodePresetSquareDetailResult({ item, fetchedAt: new Date(this.now()).toISOString() })
  }

  async previewInstall(value: unknown): Promise<PresetInstallPreviewResult> {
    const request = decodePresetInstallPreviewRequest(value)
    const item = await this.requireItem(request.slug)
    const archive = await this.download(item)
    const host = await this.importIntoHost(archive, request.targetId, false)
    if (host.sourcePresetId !== item.presetId) {
      throw new Error('Preset package manifest does not match the published Preset id')
    }
    const { installed: _installed, ...preview } = host
    return decodePresetInstallPreviewResult({
      ...preview,
      slug: item.slug,
      title: item.title,
    })
  }

  async install(value: unknown): Promise<PresetInstallResult> {
    const request = decodePresetInstallRequest(value)
    const item = await this.requireItem(request.slug)
    const archive = await this.download(item)
    const host = await this.importIntoHost(archive, request.targetId, true)
    if (host.sourcePresetId !== item.presetId || !host.installed) {
      throw new Error('Preset package installation did not match the published Preset')
    }
    return decodePresetInstallResult({
      ...host,
      slug: item.slug,
      title: item.title,
      installed: true,
    })
  }

  private async requireItem(slug: string): Promise<PresetSquareItem> {
    const result = await this.detail({ slug })
    if (result.item === null) throw new Error('Preset Square entry no longer exists')
    return result.item
  }

  private async download(item: PresetSquareItem): Promise<Uint8Array> {
    if (item.source === 'fufan-official') {
      const archive = await this.bundled.archive(item.slug)
      if (archive === undefined) throw new Error('Bundled Preset package is unavailable')
      this.assertArtifact(archive, item)
      return archive
    }
    const url = new URL(item.artifact.downloadUrl)
    assertSquareUrl(url)
    const response = await this.fetchResponse(url)
    if (!response.ok) throw new Error(`Preset download returned HTTP ${String(response.status)}`)
    responseUrl(response)
    const declared = responseLength(response)
    if (declared !== undefined && declared !== item.artifact.sizeBytes) {
      throw new Error('Preset download size does not match published metadata')
    }
    if (item.artifact.sizeBytes > MAX_ARCHIVE_BYTES) throw new Error('Preset package is larger than 16 MB')
    const bytes = new Uint8Array(await response.arrayBuffer())
    this.assertArtifact(bytes, item)
    return bytes
  }

  private assertArtifact(bytes: Uint8Array, item: PresetSquareItem): void {
    if (bytes.length !== item.artifact.sizeBytes || bytes.length > MAX_ARCHIVE_BYTES) {
      throw new Error('Preset download size does not match published metadata')
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== item.artifact.sha256) throw new Error('Preset package SHA-256 does not match published metadata')
  }

  private async importIntoHost(
    data: Uint8Array,
    targetId: string | null,
    install: boolean,
  ): Promise<{
    readonly targetId: string
    readonly sourcePresetId: string
    readonly name: string | null
    readonly description: string | null
    readonly sourceDshVersion: string | null
    readonly fileCount: number
    readonly warnings: readonly string[]
    readonly conflict: boolean
    readonly installed: boolean
  }> {
    const origin = this.hostOrigin()
    if (origin === undefined) throw new Error('Desktop Host is unavailable')
    const url = new URL('/api/agent-preset.import', origin)
    if (targetId !== null) url.searchParams.set('targetId', targetId)
    if (install) url.searchParams.set('install', '1')
    const response = await this.fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/vnd.dsh.preset+zip',
        'content-length': String(data.length),
      },
      body: Buffer.from(data),
    })
    const body = await this.readBoundedJson(response, MAX_METADATA_BYTES)
    if (!response.ok || typeof body !== 'object' || body === null || Array.isArray(body)
      || (body as Record<string, unknown>)['ok'] !== true) {
      const message = typeof body === 'object' && body !== null && !Array.isArray(body)
        && typeof (body as Record<string, unknown>)['error'] === 'string'
        ? (body as Record<string, string>)['error']
        : `Preset import returned HTTP ${String(response.status)}`
      throw new Error(message)
    }
    const source = body as Record<string, unknown>
    const normalized = {
      targetId: source['targetId'],
      sourcePresetId: source['sourcePresetId'],
      name: source['name'],
      description: source['description'],
      sourceDshVersion: source['sourceDshVersion'],
      fileCount: source['fileCount'],
      warnings: source['warnings'],
      conflict: source['conflict'],
    }
    const preview = decodePresetInstallPreviewResult({
      ...normalized,
      slug: 'host-preview',
      title: 'Host preview',
    })
    return {
      targetId: preview.targetId,
      sourcePresetId: preview.sourcePresetId,
      name: preview.name,
      description: preview.description,
      sourceDshVersion: preview.sourceDshVersion,
      fileCount: preview.fileCount,
      warnings: preview.warnings,
      conflict: preview.conflict,
      installed: source['installed'] === true,
    }
  }

  private async fetchResponse(url: URL): Promise<Response> {
    assertSquareUrl(url)
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      return await this.fetcher(url, { redirect: 'error', signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async readJson(url: URL): Promise<unknown> {
    const response = await this.fetchResponse(url)
    return await this.readJsonResponse(response, url)
  }

  private async readJsonResponse(response: Response, requested: URL): Promise<unknown> {
    if (!response.ok) throw new Error(`Preset Square returned HTTP ${String(response.status)}`)
    const final = responseUrl(response)
    if (final !== undefined && final.href !== requested.href) throw new Error('Preset Square response was redirected')
    return await this.readBoundedJson(response, MAX_METADATA_BYTES)
  }

  private async readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
    const declared = responseLength(response)
    if (declared !== undefined && declared > maxBytes) throw new Error('Preset Square response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('Preset Square response is too large')
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
      throw new Error('Preset Square returned invalid JSON')
    }
  }
}
