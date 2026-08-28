import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneRuntimeMetadata } from '../scripts/runtime-staging-pruner.ts'

describe('Desktop runtime staging metadata pruning', () => {
  it('removes declarations and source maps while retaining executable package files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-prune-'))
    try {
      const nested = join(root, 'package', 'dist')
      await mkdir(nested, { recursive: true })
      await Promise.all([
        writeFile(join(nested, 'index.js'), 'export const value = 1\n'),
        writeFile(join(nested, 'index.js.map'), '{}\n'),
        writeFile(join(nested, 'index.d.ts'), 'export declare const value: number\n'),
        writeFile(join(nested, 'index.d.mts'), 'export declare const value: number\n'),
        writeFile(join(nested, 'index.d.cts'), 'export declare const value: number\n'),
        writeFile(join(root, 'package', 'package.json'), '{"type":"module"}\n'),
      ])

      await expect(pruneRuntimeMetadata(root)).resolves.toBe(4)
      await expect(readFile(join(nested, 'index.js'), 'utf8')).resolves.toContain('value = 1')
      await expect(readFile(join(root, 'package', 'package.json'), 'utf8')).resolves.toContain('module')
      await expect(access(join(nested, 'index.js.map'))).rejects.toThrow()
      await expect(access(join(nested, 'index.d.ts'))).rejects.toThrow()
      await expect(access(join(nested, 'index.d.mts'))).rejects.toThrow()
      await expect(access(join(nested, 'index.d.cts'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
