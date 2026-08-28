/** Build the final FF - LLM Wiki source into an isolated plugin runtime. */

import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const application = join(root, 'application')
const temporary = join(root, '.application-build')
const runtime = join(root, 'runtime')

await rm(temporary, { recursive: true, force: true })
await rm(runtime, { recursive: true, force: true })
await mkdir(temporary, { recursive: true })
await mkdir(join(runtime, 'api'), { recursive: true })

execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: application, stdio: 'inherit' })
execFileSync('pnpm', ['--filter', '@llmwiki/contracts', 'build'], { cwd: application, stdio: 'inherit' })

await build({
  entryPoints: [join(application, 'apps/api/src/index.ts')],
  outfile: join(runtime, 'api/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  alias: {
    '@llmwiki/contracts': join(application, 'packages/contracts/src/index.ts'),
  },
})

const webBuild = join(temporary, 'web')
await cp(join(application, 'apps/web'), webBuild, {
  recursive: true,
  filter: (source) => !source.includes('/.next') && !source.endsWith('/node_modules'),
})
await symlink(join(application, 'apps/web/node_modules'), join(webBuild, 'node_modules'))
const nextConfigPath = join(webBuild, 'next.config.ts')
const nextConfig = await readFile(nextConfigPath, 'utf8')
await writeFile(nextConfigPath, nextConfig.replace(
  'const nextConfig: NextConfig = {',
  'const nextConfig: NextConfig = {\n  output: "export",\n  trailingSlash: true,\n  images: { unoptimized: true },',
))
execFileSync('pnpm', ['exec', 'next', 'build'], {
  cwd: webBuild,
  env: { ...process.env, NEXT_PUBLIC_API_URL: '' },
  stdio: 'inherit',
})
await cp(join(webBuild, 'out'), join(runtime, 'web'), { recursive: true })

await mkdir(join(runtime, 'seed'), { recursive: true })
await cp(join(application, 'content'), join(runtime, 'seed/content'), { recursive: true })
await cp(join(application, 'output'), join(runtime, 'seed/output'), { recursive: true })
const sourceDatabase = new Database(join(application, 'data/llmwiki.db'), { readonly: true })
try {
  await sourceDatabase.backup(join(runtime, 'seed/llmwiki.db'))
} finally {
  sourceDatabase.close()
}

await rm(temporary, { recursive: true, force: true })
