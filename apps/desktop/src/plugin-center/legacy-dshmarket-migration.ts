/** One-time repair for profiles that activate dshmarket both as a Bundle and as a legacy manual insert. */

import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readProfileBundleState, readProfileManifest, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml'

const PACKAGE_NAME = 'dshmarket'
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

interface BundleManifest {
  readonly name?: unknown
  readonly dsh?: {
    readonly bundle?: {
      readonly patch?: unknown
    }
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    return metadata.isFile() && !metadata.isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function scalarString(value: unknown): string | undefined {
  return isScalar(value) && typeof value.value === 'string' ? value.value : undefined
}

function mapValue(map: YAMLMap, key: string): unknown {
  const pair = map.items.find(item => scalarString(item.key) === key)
  return pair?.value
}

function entryPackageName(value: unknown): string | undefined {
  return isMap(value) ? scalarString(mapValue(value, 'name')) : undefined
}

function insertedPackageCount(source: string, path: string, packageName: string): number {
  const document = parseDocument(source, { keepSourceTokens: true })
  if (document.errors.length > 0) {
    throw new Error(`cannot inspect ${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  if (!isSeq(document.contents)) return 0
  let count = 0
  for (const patch of document.contents.items) {
    if (!isMap(patch)) continue
    const inserted = mapValue(patch, 'insert')
    if (!isSeq(inserted)) continue
    count += inserted.items.filter(entry => entryPackageName(entry) === packageName).length
  }
  return count
}

function removeInsertedPackage(source: string, path: string, packageName: string): {
  readonly content: string
  readonly removedEntries: number
} {
  const document = parseDocument(source, { keepSourceTokens: true })
  if (document.errors.length > 0) {
    throw new Error(`cannot migrate ${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  if (!isSeq(document.contents)) return { content: source, removedEntries: 0 }

  let removedEntries = 0
  for (let patchIndex = document.contents.items.length - 1; patchIndex >= 0; patchIndex -= 1) {
    const patch: unknown = document.contents.items[patchIndex]
    if (!isMap(patch)) continue
    const insertPairIndex = patch.items.findIndex(item => scalarString(item.key) === 'insert')
    if (insertPairIndex < 0) continue
    const inserted = patch.items[insertPairIndex]?.value
    if (!isSeq(inserted)) continue
    for (let entryIndex = inserted.items.length - 1; entryIndex >= 0; entryIndex -= 1) {
      if (entryPackageName(inserted.items[entryIndex]) !== packageName) continue
      inserted.items.splice(entryIndex, 1)
      removedEntries += 1
    }
    if (inserted.items.length > 0) continue
    if (patch.items.length === 1) document.contents.items.splice(patchIndex, 1)
    else patch.items.splice(insertPairIndex, 1)
  }
  return {
    content: removedEntries === 0 ? source : document.toString(),
    removedEntries,
  }
}

function resolvesInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path.length > 0 && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

/**
 * Remove only legacy manual dshmarket inserts after verifying that the installed Bundle owns the activation.
 * Direct id-targeted configuration overrides and unrelated patch rows remain unchanged.
 */
export async function migrateLegacyDshmarketRegistration(input: {
  readonly profileDirectory: string
  readonly installAnchor: string
}): Promise<{
  readonly removedEntries: number
}> {
  const manifest = readProfileManifest('desktop', input.profileDirectory)
  const bundleState = readProfileBundleState(manifest)
  if (![...bundleState.bundles, ...bundleState.disabledBundles].includes(PACKAGE_NAME)) {
    return { removedEntries: 0 }
  }

  const packageDirectory = resolveBundleDir(
    'desktop', PACKAGE_NAME, input.installAnchor, input.profileDirectory,
  )
  const manifestPath = join(packageDirectory, 'package.json')
  if (!await isRegularFile(manifestPath)) return { removedEntries: 0 }
  const bundleManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BundleManifest
  const declaredPatch = bundleManifest.dsh?.bundle?.patch
  if (bundleManifest.name !== PACKAGE_NAME || typeof declaredPatch !== 'string' || declaredPatch.length === 0) {
    return { removedEntries: 0 }
  }
  const bundlePatchPath = resolve(packageDirectory, declaredPatch)
  if (!resolvesInside(packageDirectory, bundlePatchPath) || !await isRegularFile(bundlePatchPath)) {
    return { removedEntries: 0 }
  }
  const bundlePatch = await readFile(bundlePatchPath, 'utf8')
  if (insertedPackageCount(bundlePatch, bundlePatchPath, PACKAGE_NAME) === 0) {
    return { removedEntries: 0 }
  }

  const profilePatchPath = join(input.profileDirectory, PROFILE_PATCH_FILENAME)
  if (!await isRegularFile(profilePatchPath)) return { removedEntries: 0 }
  const profilePatch = await readFile(profilePatchPath, 'utf8')
  const migrated = removeInsertedPackage(profilePatch, profilePatchPath, PACKAGE_NAME)
  if (migrated.removedEntries === 0) return { removedEntries: 0 }
  await writeFileAtomic(profilePatchPath, migrated.content, { mode: 0o600, dirMode: 0o700 })
  return { removedEntries: migrated.removedEntries }
}
