/** Remove compile-time metadata from the packaged Desktop Host dependency tree. */

import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const NON_RUNTIME_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.map'] as const

/**
 * Remove declaration and source-map files that Node never reads at runtime.
 * @param directory - Materialized production dependency directory.
 * @returns The number of files removed from the packaged runtime.
 */
export async function pruneRuntimeMetadata(directory: string): Promise<number> {
  let removed = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      removed += await pruneRuntimeMetadata(path)
      continue
    }
    if (!entry.isFile() || !NON_RUNTIME_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue
    await rm(path)
    removed += 1
  }
  return removed
}
