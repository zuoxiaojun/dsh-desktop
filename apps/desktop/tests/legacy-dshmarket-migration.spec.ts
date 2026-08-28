import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeEntries, initProfile, loadProfile, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { migrateLegacyDshmarketRegistration } from '../src/plugin-center/legacy-dshmarket-migration.ts'

const roots: string[] = []
const PACKAGE_NAME = 'dshmarket'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(options: { readonly bundleActivatesPackage?: boolean; readonly listed?: boolean } = {}): Promise<{
  readonly home: string
  readonly profile: string
  readonly patchPath: string
}> {
  const root = join(tmpdir(), `dshmarket-migration-${process.pid}-${String(roots.length)}`)
  await rm(root, { recursive: true, force: true })
  roots.push(root)
  const profile = join(root, 'profiles', 'web')
  initProfile(profile, [])
  const manifest = readProfileManifest('test', profile)
  manifest.dependencies = { [PACKAGE_NAME]: '1.16.3' }
  manifest.dsh = {
    ...manifest.dsh,
    profile: { bundles: options.listed === false ? [] : [PACKAGE_NAME] },
  }
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const packageDirectory = join(profile, 'node_modules', PACKAGE_NAME)
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), `${JSON.stringify({
    name: PACKAGE_NAME,
    version: '1.16.3',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  await writeFile(join(packageDirectory, 'cordis.patch.yml'), options.bundleActivatesPackage === false
    ? '- insert:\n    - id: unrelated\n      name: unrelated\n'
    : '- insert:\n    - id: dsh-market\n      name: dshmarket\n')

  const patchPath = join(profile, 'cordis.patch.yml')
  await writeFile(patchPath, `# user profile comment
- insert:
    - id: legacy-market
      name: dshmarket # duplicate from an older installer
    - id: retained
      name: retained-plugin
- id: dsh-market
  config:
    allowRestart: false
    token: !!js process.env.DSHMARKET_TOKEN
`)
  return { home: root, profile, patchPath }
}

describe('legacy dshmarket profile migration', () => {
  it('removes only the redundant manual insert and preserves the id override and unrelated rows', async () => {
    const value = await fixture()

    const migrationInput = { profileDirectory: value.profile, installAnchor: join(value.profile, 'package.json') }
    await expect(migrateLegacyDshmarketRegistration(migrationInput)).resolves.toEqual({ removedEntries: 1 })

    const migrated = await readFile(value.patchPath, 'utf8')
    expect(migrated).toContain('# user profile comment')
    expect(migrated).toContain('name: retained-plugin')
    expect(migrated).toContain('id: dsh-market')
    expect(migrated).toContain('allowRestart: false')
    expect(migrated).toContain('!!js process.env.DSHMARKET_TOKEN')
    expect(migrated).not.toContain('id: legacy-market')
    const loaded = loadProfile('test', 'web', join(value.profile, 'package.json'), value.home)
    const entries = composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches])
    expect(entries.filter(entry => entry.name === PACKAGE_NAME)).toEqual([
      expect.objectContaining({ id: 'dsh-market', config: expect.objectContaining({ allowRestart: false }) }),
    ])
    await expect(migrateLegacyDshmarketRegistration(migrationInput)).resolves.toEqual({ removedEntries: 0 })
  })

  it('does not change a manual installation when no verified dshmarket Bundle owns activation', async () => {
    for (const options of [{ listed: false }, { bundleActivatesPackage: false }]) {
      const value = await fixture(options)
      const before = await readFile(value.patchPath, 'utf8')
      await expect(migrateLegacyDshmarketRegistration({
        profileDirectory: value.profile,
        installAnchor: join(value.profile, 'package.json'),
      })).resolves.toEqual({ removedEntries: 0 })
      await expect(readFile(value.patchPath, 'utf8')).resolves.toBe(before)
    }
  })
})
