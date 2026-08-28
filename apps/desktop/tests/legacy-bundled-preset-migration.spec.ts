import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyBundledContentPreset } from '../src/preset-square/legacy-bundled-preset-migration.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ home: string; bundled: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-preset-'))
  roots.push(root)
  const home = join(root, 'home')
  const bundled = join(root, 'bundled')
  const target = join(home, '.agent-presets', 'ai-content-image-studio')
  const source = join(bundled, 'fufan-content-factory', 'preset')
  await mkdir(target, { recursive: true })
  await mkdir(join(source, 'runtime', 'content-imagegen'), { recursive: true })
  await writeFile(join(source, 'agent.cordis.yml'), '- id: content-imagegen-tools\n  name: ./runtime/content-imagegen/index.js\n')
  await writeFile(join(source, 'preset.yml'), 'name: current\n')
  await writeFile(join(source, 'runtime', 'content-imagegen', 'index.js'), 'export const name = "current"\n')
  return { home, bundled, target }
}

describe('legacy bundled Preset migration', () => {
  it('atomically replaces the exact legacy content Preset with the current bundled copy', async () => {
    const { home, bundled, target } = await fixture()
    await writeFile(join(target, 'agent.cordis.yml'), [
      '- id: persona',
      '  name: @deepseek-ai/dsh-persona',
      '- id: dsh-content-imagen-tools',
      '  name: dsh-content-imagen',
      '  config:',
      '    timeoutMs: 240000',
      '',
    ].join('\n'))
    await writeFile(join(target, 'legacy.txt'), 'legacy')

    await expect(migrateLegacyBundledContentPreset({ homeDirectory: home, bundledPresetRoot: bundled }))
      .resolves.toBe(true)
    await expect(readFile(join(target, 'agent.cordis.yml'), 'utf8'))
      .resolves.toContain('./runtime/content-imagegen/index.js')
    await expect(readFile(join(target, 'runtime', 'content-imagegen', 'index.js'), 'utf8'))
      .resolves.toContain('current')
    await expect(readFile(join(target, 'legacy.txt'), 'utf8')).resolves.toBe('legacy')
    await expect(readdir(join(home, '.agent-presets'))).resolves.toEqual(['ai-content-image-studio'])
  })

  it('does not overwrite a current or user-authored Preset', async () => {
    const { home, bundled, target } = await fixture()
    const current = '- id: content-imagegen-tools\n  name: ./runtime/content-imagegen/index.js\n'
    await writeFile(join(target, 'agent.cordis.yml'), current)

    await expect(migrateLegacyBundledContentPreset({ homeDirectory: home, bundledPresetRoot: bundled }))
      .resolves.toBe(false)
    await expect(readFile(join(target, 'agent.cordis.yml'), 'utf8')).resolves.toBe(current)
  })
})
