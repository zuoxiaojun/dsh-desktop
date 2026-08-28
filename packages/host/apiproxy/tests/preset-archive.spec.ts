import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  importPresetArchive,
  parsePresetArchive,
  PresetArchiveError,
  type PresetArchiveRoster,
} from '../src/preset-archive.ts'

function archive(overrides: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({
      format: 'dsh-preset',
      version: 1,
      id: 'fixture-preset',
      name: 'Fixture Preset',
      sourceDshVersion: '0.1.0-rc.5',
    })),
    'preset/agent.cordis.yml': strToU8('- name: fixture.plugin\n'),
    'preset/README.md': strToU8('Fixture preset.'),
    ...overrides,
  })
}

describe('Preset archive import', () => {
  it('parses and atomically installs a valid user preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-root-'))
    const roster: PresetArchiveRoster = {
      roots: [{ path: root, trust: 'user' }],
      list: async () => [],
    }
    const preview = await importPresetArchive(roster, archive(), {
      install: false,
      currentDshVersion: '0.1.0-rc.5',
    })
    expect(preview).toMatchObject({ targetId: 'fixture-preset', conflict: false, installed: false, fileCount: 2 })

    const installed = await importPresetArchive(roster, archive(), {
      install: true,
      currentDshVersion: '0.1.0-rc.5',
    })
    expect(installed.installed).toBe(true)
    expect(await readFile(join(root, 'fixture-preset', 'agent.cordis.yml'), 'utf8'))
      .toBe('- name: fixture.plugin\n')
    expect((await stat(join(root, 'fixture-preset'))).isDirectory()).toBe(true)
  })

  it('reports version and executable-content warnings without installing during preview', async () => {
    const parsed = parsePresetArchive(archive({
      'preset/config.yml': strToU8('api_key: "sk-12345678901234567890"\npath: /Users/example/work\n'),
    }))
    expect(parsed.warnings).toEqual(['absolute-paths', 'possible-secrets'])
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-preview-'))
    const result = await importPresetArchive({
      roots: [{ path: root, trust: 'user' }],
      list: async () => [],
    }, archive(), { install: false, currentDshVersion: '0.1.0-rc.7' })
    expect(result.warnings).toEqual(['version-mismatch'])
  })

  it('does not mistake an HTTPS URL scheme for a Windows absolute path', () => {
    const parsed = parsePresetArchive(archive({
      'preset/scripts/search.mjs': strToU8("const registry = 'https://registry.npmjs.org'\n"),
    }))
    const windowsPath = parsePresetArchive(archive({
      'preset/config.yml': strToU8('workspace: C:\\Users\\example\\work\n'),
    }))

    expect(parsed.warnings).toEqual([])
    expect(windowsPath.warnings).toEqual(['absolute-paths'])
  })

  it.each([
    ['missing composition', zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'dsh-preset', version: 1, id: 'fixture-preset' })),
    })],
    ['parent traversal', zipSync({ '../escape': strToU8('bad') })],
    ['absolute path', zipSync({ '/escape': strToU8('bad') })],
    ['invalid manifest', zipSync({ 'manifest.json': strToU8('{}'), 'preset/agent.cordis.yml': strToU8('[]') })],
  ])('rejects %s', (_name, data) => {
    expect(() => parsePresetArchive(data)).toThrow(PresetArchiveError)
  })

  it('refuses an occupied target before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-conflict-'))
    const roster: PresetArchiveRoster = {
      roots: [{ path: root, trust: 'user' }],
      list: async () => [{
        id: 'fixture-preset', trust: 'user', path: join(root, 'fixture-preset', 'agent.cordis.yml'),
      }],
    }
    await expect(importPresetArchive(roster, archive(), {
      install: true,
      currentDshVersion: '0.1.0-rc.5',
    })).rejects.toMatchObject({ status: 409 })
  })
})
