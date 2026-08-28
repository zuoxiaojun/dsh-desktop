/** Safe preview and atomic installation for binary `.dshpreset` archives. */

import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import {
  COMPOSITION_FILE,
  scanRoot,
  writableRoot,
  type AgentPreset,
  type PresetRoot,
} from '@deepseek-ai/dsh-agent-presets'
import { strFromU8, unzipSync } from 'fflate'

/** Media type accepted by the loopback Preset archive endpoint. */
export const PRESET_ARCHIVE_MIME = 'application/vnd.dsh.preset+zip'
/** Maximum compressed Preset archive size accepted by Desktop and Host. */
export const PRESET_ARCHIVE_MAX_COMPRESSED = 16 * 1024 * 1024
/** Maximum aggregate expanded size accepted from one Preset archive. */
export const PRESET_ARCHIVE_MAX_UNCOMPRESSED = 32 * 1024 * 1024
/** Maximum expanded size accepted for one Preset archive file. */
export const PRESET_ARCHIVE_MAX_FILE = 12 * 1024 * 1024
/** Maximum number of Preset payload files accepted beside the manifest. */
export const PRESET_ARCHIVE_MAX_FILES = 512

const PRESET_ARCHIVE_ID = /^[a-z0-9][a-z0-9-]*$/u
const PRESET_ARCHIVE_IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const PRESET_TEXT_EXTENSIONS = new Set([
  '.json', '.jsonc', '.md', '.txt', '.yaml', '.yml', '.toml', '.js', '.jsx', '.ts', '.tsx',
  '.mjs', '.cjs', '.py', '.sh', '.ps1', '.html', '.css',
])

/** Review warning detected without rejecting an otherwise valid Preset archive. */
export type PresetArchiveWarning = 'absolute-paths' | 'possible-secrets' | 'version-mismatch'

/** Versioned package identity read from `manifest.json`. */
export interface PresetArchiveManifest {
  readonly format: 'dsh-preset'
  readonly version: 1
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly sourceDshVersion?: string
}

/** Validated in-memory Preset payload before any filesystem write. */
export interface ParsedPresetArchive {
  readonly manifest: PresetArchiveManifest
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly warnings: readonly Exclude<PresetArchiveWarning, 'version-mismatch'>[]
}

/** Renderer-safe preview or completed import evidence. */
export interface PresetArchivePreview {
  readonly targetId: string
  readonly sourcePresetId: string
  readonly name: string | null
  readonly description: string | null
  readonly sourceDshVersion: string | null
  readonly fileCount: number
  readonly warnings: readonly PresetArchiveWarning[]
  readonly conflict: boolean
  readonly installed: boolean
}

/** Minimal live roster face needed by the importer. */
export interface PresetArchiveRoster {
  readonly roots: readonly PresetRoot[]
  list(): Promise<readonly AgentPreset[]>
}

/** Stable HTTP-facing import failure. */
export class PresetArchiveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'PresetArchiveError'
  }
}

function safeArchivePath(name: string): boolean {
  if (name === '' || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/u.test(name)) {
    return false
  }
  return name.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function archiveWarnings(files: Readonly<Record<string, Uint8Array>>): readonly Exclude<PresetArchiveWarning, 'version-mismatch'>[] {
  let hasAbsolutePath = false
  let hasPossibleSecret = false
  for (const [name, data] of Object.entries(files)) {
    if (!PRESET_TEXT_EXTENSIONS.has(extname(name).toLowerCase()) || data.length > 1024 * 1024 || data.includes(0)) {
      continue
    }
    const text = strFromU8(data)
    if (/(?:^|[\s"'(:=])(?:\/Users\/|\/home\/)/mu.test(text)
      || /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/u.test(text)
      || /\\\\[^\\\s]+[\\/]/u.test(text)) {
      hasAbsolutePath = true
    }
    if (/(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[^\s"']{12,}|\bsk-[a-z0-9_-]{16,}/iu.test(text)) {
      hasPossibleSecret = true
    }
  }
  return [
    ...hasAbsolutePath ? ['absolute-paths' as const] : [],
    ...hasPossibleSecret ? ['possible-secrets' as const] : [],
  ]
}

/**
 * Parse one bounded archive without writing to disk.
 * @param data - Compressed `.dshpreset` bytes received from Desktop.
 * @returns Validated manifest, payload files, and review warnings.
 */
export function parsePresetArchive(data: Uint8Array): ParsedPresetArchive {
  if (data.length === 0) throw new PresetArchiveError('Preset package is empty.')
  if (data.length > PRESET_ARCHIVE_MAX_COMPRESSED) {
    throw new PresetArchiveError('Preset package is larger than 16 MB.', 413)
  }
  let count = 0
  let total = 0
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(data, {
      filter(file) {
        const isDirectory = file.name.endsWith('/')
        const path = isDirectory ? file.name.slice(0, -1) : file.name
        if (!safeArchivePath(path)) throw new PresetArchiveError(`Preset package contains an unsafe path: ${file.name}`)
        if (isDirectory) return false
        count += 1
        if (count > PRESET_ARCHIVE_MAX_FILES + 1) {
          throw new PresetArchiveError(`Preset package contains more than ${String(PRESET_ARCHIVE_MAX_FILES)} files.`)
        }
        if (file.originalSize > PRESET_ARCHIVE_MAX_FILE) {
          throw new PresetArchiveError(`Preset package contains an oversized file: ${file.name}`)
        }
        total += file.originalSize
        if (total > PRESET_ARCHIVE_MAX_UNCOMPRESSED) {
          throw new PresetArchiveError('Expanded preset package is larger than 32 MB.', 413)
        }
        return true
      },
    })
  } catch (error: unknown) {
    if (error instanceof PresetArchiveError) throw error
    throw new PresetArchiveError(`Preset package is not a valid ZIP archive: ${String(error)}`)
  }
  const manifestBytes = archive['manifest.json']
  if (manifestBytes === undefined) throw new PresetArchiveError('Preset package has no manifest.json.')
  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(strFromU8(manifestBytes))
  } catch {
    throw new PresetArchiveError('Preset package manifest is not valid JSON.')
  }
  if (typeof rawManifest !== 'object' || rawManifest === null || Array.isArray(rawManifest)) {
    throw new PresetArchiveError('Preset package manifest is unsupported or invalid.')
  }
  const source = rawManifest as Record<string, unknown>
  if (source['format'] !== 'dsh-preset' || source['version'] !== 1
    || typeof source['id'] !== 'string' || !PRESET_ARCHIVE_ID.test(source['id'])) {
    throw new PresetArchiveError('Preset package manifest is unsupported or invalid.')
  }
  if (source['name'] !== undefined && (typeof source['name'] !== 'string' || source['name'].length > 160)) {
    throw new PresetArchiveError('Preset package manifest has an invalid name.')
  }
  if (source['description'] !== undefined
    && (typeof source['description'] !== 'string' || source['description'].length > 4_000)) {
    throw new PresetArchiveError('Preset package manifest has an invalid description.')
  }
  if (source['sourceDshVersion'] !== undefined
    && (typeof source['sourceDshVersion'] !== 'string' || source['sourceDshVersion'].length > 64)) {
    throw new PresetArchiveError('Preset package manifest has an invalid DSH version.')
  }
  const manifest: PresetArchiveManifest = {
    format: 'dsh-preset',
    version: 1,
    id: source['id'],
    ...typeof source['name'] === 'string' ? { name: source['name'] } : {},
    ...typeof source['description'] === 'string' ? { description: source['description'] } : {},
    ...typeof source['sourceDshVersion'] === 'string' ? { sourceDshVersion: source['sourceDshVersion'] } : {},
  }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const [name, bytes] of Object.entries(archive)) {
    if (name === 'manifest.json') continue
    if (!name.startsWith('preset/') || name === 'preset/') {
      throw new PresetArchiveError(`Unexpected file outside the preset directory: ${name}`)
    }
    const relative = name.slice('preset/'.length)
    if (!safeArchivePath(relative)) throw new PresetArchiveError(`Preset package contains an unsafe path: ${relative}`)
    if (PRESET_ARCHIVE_IGNORED_FILES.has(relative.split('/').at(-1) ?? '')) continue
    files[relative] = bytes
  }
  if (files[COMPOSITION_FILE] === undefined) {
    throw new PresetArchiveError(`Preset package is missing preset/${COMPOSITION_FILE}.`)
  }
  return { manifest, files, warnings: archiveWarnings(files) }
}

async function pathOccupied(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Preview or atomically install an already downloaded and integrity-checked archive.
 * @param presets - Authoritative local Preset roots and live roster.
 * @param data - Compressed archive bytes verified by Desktop.
 * @param options - Target identity, write intent, and running DSH version.
 * @param signal - Optional caller cancellation propagated by the loopback carrier.
 * @returns Validated preview and, for a write, committed installation evidence.
 */
export async function importPresetArchive(
  presets: PresetArchiveRoster,
  data: Uint8Array,
  options: { readonly targetId?: string; readonly install: boolean; readonly currentDshVersion: string },
  signal?: AbortSignal,
): Promise<PresetArchivePreview> {
  signal?.throwIfAborted()
  const parsed = parsePresetArchive(data)
  const targetId = options.targetId ?? parsed.manifest.id
  if (!PRESET_ARCHIVE_ID.test(targetId)) {
    throw new PresetArchiveError('Use lowercase letters, digits, and hyphens, starting with a letter or digit.')
  }
  const rows = await presets.list()
  const conflict = rows.some(row => row.id === targetId)
  const warnings: PresetArchiveWarning[] = [
    ...parsed.warnings,
    ...parsed.manifest.sourceDshVersion !== undefined
      && parsed.manifest.sourceDshVersion !== options.currentDshVersion
      ? ['version-mismatch' as const]
      : [],
  ]
  const preview: PresetArchivePreview = {
    targetId,
    sourcePresetId: parsed.manifest.id,
    name: parsed.manifest.name ?? null,
    description: parsed.manifest.description ?? null,
    sourceDshVersion: parsed.manifest.sourceDshVersion ?? null,
    fileCount: Object.keys(parsed.files).length,
    warnings,
    conflict,
    installed: false,
  }
  if (!options.install) return preview
  if (conflict) throw new PresetArchiveError(`A preset named "${targetId}" already exists. Choose another identifier.`, 409)

  const root = writableRoot(presets.roots)
  const target = join(root, targetId)
  let container: string | undefined
  try {
    signal?.throwIfAborted()
    await mkdir(root, { recursive: true })
    if (await pathOccupied(target)) {
      throw new PresetArchiveError(`A preset named "${targetId}" already exists. Choose another identifier.`, 409)
    }
    container = await mkdtemp(join(root, '.dshpreset-import-'))
    const imported = join(container, targetId)
    await mkdir(imported, { recursive: true })
    for (const [name, bytes] of Object.entries(parsed.files)) {
      signal?.throwIfAborted()
      const destination = resolve(imported, name)
      if (!destination.startsWith(`${resolve(imported)}${sep}`)) {
        throw new PresetArchiveError(`Preset package contains an unsafe path: ${name}`)
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, bytes)
    }
    const scanned = await scanRoot({ path: container, trust: 'user' })
    const candidate = scanned.find(row => row.id === targetId)
    if (candidate === undefined) throw new PresetArchiveError('The imported package did not produce a preset.')
    if (candidate.broken !== undefined) {
      throw new PresetArchiveError(`The imported preset failed validation: ${candidate.broken}`)
    }
    await rename(imported, target)
    return { ...preview, conflict: false, installed: true }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
      throw new PresetArchiveError(`A preset named "${targetId}" already exists. Choose another identifier.`, 409)
    }
    throw error
  } finally {
    if (container !== undefined) await rm(container, { recursive: true, force: true }).catch(() => {})
  }
}
