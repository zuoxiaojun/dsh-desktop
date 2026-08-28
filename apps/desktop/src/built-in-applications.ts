/** Startup reconciliation for applications owned by the Desktop release. */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readProfileManifest, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'

/** Keep release-owned applications enabled and remove stale profile-installed copies. */
export function reconcileBuiltInApplications(
  profileDirectory: string,
  packageNames: readonly string[],
): void {
  const manifest = readProfileManifest('desktop', profileDirectory)
  const profile = manifest.dsh?.profile
  const bundles = [...(profile?.bundles ?? [])]
  const disabledBundles = [...(profile?.disabledBundles ?? [])]
  const dependencies = { ...manifest.dependencies }
  let changed = false

  for (const packageName of packageNames) {
    if (!bundles.includes(packageName)) {
      bundles.push(packageName)
      changed = true
    }
    const disabledIndex = disabledBundles.indexOf(packageName)
    if (disabledIndex !== -1) {
      disabledBundles.splice(disabledIndex, 1)
      changed = true
    }
    if (dependencies[packageName] !== undefined) {
      Reflect.deleteProperty(dependencies, packageName)
      changed = true
    }

    // A profile-local package wins Node resolution over the release fallback.
    // Removing only this release-owned code copy preserves application data.
    rmSync(join(profileDirectory, 'node_modules', ...packageName.split('/')), {
      force: true,
      recursive: true,
    })
  }

  if (!changed) return
  writeProfileManifest(profileDirectory, {
    ...manifest,
    dependencies,
    dsh: {
      ...manifest.dsh,
      profile: { ...profile, bundles, disabledBundles },
    },
  })
}
