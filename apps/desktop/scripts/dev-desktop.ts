/** Desktop development launcher. */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const DESKTOP_DIR = resolve(import.meta.dirname, '..')
const ROOT = resolve(DESKTOP_DIR, '../..')
const FINGERPRINT_FILE = resolve(DESKTOP_DIR, 'lib/.dev-fingerprint')

interface Fingerprint {
  sources: Record<string, string>
  tsconfig: Record<string, string>
  version: string
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function collectFingerprint(): Fingerprint {
  return {
    version: '1',
    sources: {
      main: hash(readFileSync(resolve(DESKTOP_DIR, 'src/main.ts'), 'utf8')),
      preload: hash(readFileSync(resolve(DESKTOP_DIR, 'src/preload.ts'), 'utf8')),
      supervisor: hash(readFileSync(resolve(DESKTOP_DIR, 'src/host-supervisor.ts'), 'utf8')),
      lifecycle: hash(readFileSync(resolve(DESKTOP_DIR, 'src/window-lifecycle.ts'), 'utf8')),
    },
    tsconfig: {
      desktop: hash(readFileSync(resolve(DESKTOP_DIR, 'tsconfig.json'), 'utf8')),
      tsdown: hash(readFileSync(resolve(DESKTOP_DIR, 'tsdown.config.ts'), 'utf8')),
    },
  }
}

function fingerprintEquals(a: Fingerprint, b: Fingerprint): boolean {
  return a.version === b.version
    && Object.entries(a.sources).every(([k, v]) => b.sources[k] === v)
    && Object.entries(a.tsconfig).every(([k, v]) => b.tsconfig[k] === v)
}

function build(): void {
  // Build host libraries first
  const hostResult = spawnSync('pnpm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  })
  if (hostResult.status !== 0) throw new Error('build failed')

  // Write fingerprint
  const fp = collectFingerprint()
  writeFileSync(FINGERPRINT_FILE, JSON.stringify(fp, null, 2))
}

function needsRebuild(): boolean {
  if (!existsSync(FINGERPRINT_FILE)) return true
  if (!existsSync(resolve(DESKTOP_DIR, 'lib/main.js'))) return true
  try {
    const current = JSON.parse(readFileSync(FINGERPRINT_FILE, 'utf8')) as Fingerprint
    return !fingerprintEquals(current, collectFingerprint())
  } catch {
    return true
  }
}

function main(): void {
  if (process.argv.includes('--rebuild') || needsRebuild()) {
    build()
  }

  const result = spawnSync('npx', ['electron', resolve(DESKTOP_DIR, 'lib/main.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
    },
  })
  process.exit(result.status ?? 1)
}

main()