import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { reconcileBuiltInApplications } from '../src/built-in-applications.ts'

describe('built-in applications', () => {
  it('replaces a stale profile-installed copy with release ownership', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-built-in-application-'))
    const profileDirectory = join(root, 'profiles', 'web')
    const packageName = '@fufan/dsh-plugin-llm-wiki'
    initProfile(profileDirectory, ['@deepseek-ai/dsh-base'])
    const manifestPath = join(profileDirectory, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      dependencies: { [packageName]: 'file:/stale/application.tgz' },
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base', packageName],
          disabledBundles: [packageName],
        },
      },
    }))
    const stalePackage = join(profileDirectory, 'node_modules', '@fufan', 'dsh-plugin-llm-wiki')
    mkdirSync(stalePackage, { recursive: true })
    writeFileSync(join(stalePackage, 'old-client.js'), 'old')

    reconcileBuiltInApplications(profileDirectory, [packageName])

    const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      readonly dependencies: Record<string, string>
      readonly dsh: { readonly profile: { readonly bundles: string[]; readonly disabledBundles: string[] } }
    }
    expect(updated.dependencies[packageName]).toBeUndefined()
    expect(updated.dsh.profile.bundles).toContain(packageName)
    expect(updated.dsh.profile.disabledBundles).not.toContain(packageName)
    expect(existsSync(stalePackage)).toBe(false)
  })
})
