/** One-time repair for the legacy bundled content Preset that cannot boot without caseRoot. */

import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const CONTENT_PRESET_ID = 'ai-content-image-studio'
const CONTENT_PRESET_SLUG = 'fufan-content-factory'
const LEGACY_ENTRY_ID = 'dsh-content-imagen-tools'
const CURRENT_ENTRY_ID = 'content-imagegen-tools'
const LEGACY_PACKAGE = /^\s+name:\s*['"]?dsh-content-imagen['"]?\s*$/mu

async function realDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    return metadata.isDirectory() && !metadata.isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    return metadata.isFile() && !metadata.isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function topLevelEntry(document: string, id: string): { readonly start: number; readonly end: number } | undefined {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`^- id:\\s*${escaped}\\s*$`, 'mu').exec(document)
  if (match === null) return undefined
  const remainderStart = match.index + match[0].length
  const next = /^- id:\s*[^\r\n]+$/mu.exec(document.slice(remainderStart))
  return { start: match.index, end: next === null ? document.length : remainderStart + next.index }
}

/**
 * Replace only the known first-party legacy plugin row and its runtime with the current bundled copy.
 * User Presets, current copies, and link-shaped targets are left untouched.
 */
export async function migrateLegacyBundledContentPreset(input: {
  readonly homeDirectory: string
  readonly bundledPresetRoot: string
}): Promise<boolean> {
  const target = join(input.homeDirectory, '.agent-presets', CONTENT_PRESET_ID)
  const composition = join(target, 'agent.cordis.yml')
  if (!await realDirectory(target) || !await regularFile(composition)) return false

  const current = await readFile(composition, 'utf8')
  const legacyRange = topLevelEntry(current, LEGACY_ENTRY_ID)
  if (legacyRange === undefined || !LEGACY_PACKAGE.test(current.slice(legacyRange.start, legacyRange.end))) return false

  const source = join(input.bundledPresetRoot, CONTENT_PRESET_SLUG, 'preset')
  const sourceComposition = join(source, 'agent.cordis.yml')
  const sourceRuntime = join(source, 'runtime', 'content-imagegen')
  if (!await realDirectory(source) || !await regularFile(sourceComposition) || !await realDirectory(sourceRuntime)) {
    throw new Error('current bundled content Preset is unavailable for legacy migration')
  }
  const replacementDocument = await readFile(sourceComposition, 'utf8')
  const replacementRange = topLevelEntry(replacementDocument, CURRENT_ENTRY_ID)
  if (replacementRange === undefined) throw new Error('current bundled content Preset has no portable runtime entry')
  const repaired = current.slice(0, legacyRange.start)
    + replacementDocument.slice(replacementRange.start, replacementRange.end)
    + current.slice(legacyRange.end)

  const runtimeParent = join(target, 'runtime')
  const runtimeParentExists = await realDirectory(runtimeParent)
  if (!runtimeParentExists) {
    try {
      await mkdir(runtimeParent, { recursive: false })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !await realDirectory(runtimeParent)) throw error
    }
  }
  const destination = join(runtimeParent, 'content-imagegen')
  let destinationExists = await realDirectory(destination)
  if (!destinationExists) {
    try {
      const metadata = await lstat(destination)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('legacy content Preset runtime target is not a real directory')
      }
      destinationExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const nonce = randomUUID()
  const staged = join(runtimeParent, `.content-imagegen.upgrade-${nonce}`)
  const backup = join(runtimeParent, `.content-imagegen.legacy-${nonce}`)
  await cp(sourceRuntime, staged, { recursive: true, force: false, errorOnExist: true })
  try {
    if (destinationExists) await rename(destination, backup)
    try {
      await rename(staged, destination)
      await writeFileAtomic(composition, repaired, { mode: 0o600, dirMode: 0o700 })
    } catch (error) {
      await rm(destination, { recursive: true, force: true })
      if (destinationExists) await rename(backup, destination)
      throw error
    }
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    throw error
  }
  if (destinationExists) {
    try {
      await rm(backup, { recursive: true, force: true })
    } catch (error) {
      // The repaired runtime is already live. A locked backup must not make Host startup fail again.
      console.warn(`could not remove migrated legacy Preset runtime backup ${backup}:`, error)
    }
  }
  return true
}
