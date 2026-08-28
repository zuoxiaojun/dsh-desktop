/** Host launcher for the unmodified FF - LLM Wiki standalone application. */

import { spawn, type ChildProcess } from 'node:child_process'
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'

const API_PREFIX = '/api/ff-llm-wiki'
const CREDENTIAL_REF = credentialRef('DEEPSEEK_API_KEY')
const START_TIMEOUT_MS = 30_000
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

class StandaloneApplication {
  private readonly packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  private readonly shippedRuntime = join(this.packageRoot, 'runtime')
  private readonly ownedRoot = dshHomePath('plugins', 'ff-llm-wiki', 'application')
  private child: ChildProcess | undefined
  private server: Server | undefined
  private appUrl: string | undefined
  private starting: Promise<string> | undefined

  constructor(private readonly ctx: Context) {}

  /** Return the current application URL, starting the isolated process once. */
  start(): Promise<string> {
    if (this.appUrl !== undefined) return Promise.resolve(this.appUrl)
    this.starting ??= this.startInternal().finally(() => { this.starting = undefined })
    return this.starting
  }

  /** Stop both the static reverse proxy and the API child process. */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.appUrl = undefined
    if (server !== undefined) {
      await new Promise<void>((done) => { server.close(() => done()) })
    }

    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((done) => { child.once('exit', () => done()) }),
      new Promise<void>((done) => { setTimeout(done, 2_000) }),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
  }

  private async startInternal(): Promise<string> {
    await this.prepareOwnedData()
    const apiPort = await freePort()
    const resolved = await this.ctx.credentials.resolve(CREDENTIAL_REF)
    const apiEntry = join(this.shippedRuntime, 'api', 'index.js')
    const child = spawn(process.execPath, [apiEntry], {
      cwd: this.ownedRoot,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(apiPort),
        DATABASE_PATH: join(this.ownedRoot, 'data', 'llmwiki.db'),
        DOCUMENT_STORAGE_PATH: join(this.ownedRoot, 'documents'),
        DOCUMENT_STAGE_DELAY_MS: '420',
        LLMWIKI_RUNTIME_ROOT: this.ownedRoot,
        DEEPSEEK_API_KEY: resolved?.value ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child

    let diagnostics = ''
    const remember = (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-4_000)
    }
    child.stdout?.on('data', remember)
    child.stderr?.on('data', remember)

    try {
      await waitForApi(apiPort, child)
      const staticRoot = join(this.shippedRuntime, 'web')
      const server = createServer((request, response) => {
        void this.handleRequest(request, response, apiPort, staticRoot).catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy()
            return
          }
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(error instanceof Error ? error.message : String(error))
        })
      })
      await listen(server)
      this.server = server
      const address = server.address() as AddressInfo
      this.appUrl = `http://127.0.0.1:${address.port}`
      child.once('exit', () => {
        if (this.child !== child) return
        this.child = undefined
        this.appUrl = undefined
        const activeServer = this.server
        this.server = undefined
        activeServer?.close()
      })
      return this.appUrl
    } catch (error) {
      child.kill('SIGTERM')
      this.child = undefined
      const suffix = diagnostics.trim().length > 0 ? `\n${diagnostics.trim()}` : ''
      throw new Error(`FF - LLM Wiki 启动失败：${error instanceof Error ? error.message : String(error)}${suffix}`)
    }
  }

  private async prepareOwnedData(): Promise<void> {
    const marker = join(this.ownedRoot, 'pnpm-workspace.yaml')
    try {
      await stat(marker)
    } catch {
      await mkdir(this.ownedRoot, { recursive: true, mode: 0o700 })
      await cp(join(this.shippedRuntime, 'seed', 'content'), join(this.ownedRoot, 'content'), { recursive: true })
      await cp(join(this.shippedRuntime, 'seed', 'output'), join(this.ownedRoot, 'output'), { recursive: true })
      await mkdir(join(this.ownedRoot, 'data'), { recursive: true, mode: 0o700 })
      await cp(join(this.shippedRuntime, 'seed', 'llmwiki.db'), join(this.ownedRoot, 'data', 'llmwiki.db'))
      await writeFile(marker, 'packages: []\n', { encoding: 'utf8', mode: 0o600 })
    }
    await mkdir(join(this.ownedRoot, 'documents'), { recursive: true, mode: 0o700 })
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    apiPort: number,
    staticRoot: string,
  ): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      proxyApi(request, response, apiPort)
      return
    }
    await serveStatic(request, response, staticRoot, pathname)
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await listen(server)
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((done) => { server.close(() => done()) })
  return port
}

function listen(server: Server): Promise<void> {
  return new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      accept()
    })
  })
}

async function waitForApi(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API 进程提前退出（${child.exitCode}）`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/qa/config`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // The child has not bound yet; the bounded loop retries.
    }
    await new Promise<void>((done) => { setTimeout(done, 100) })
  }
  throw new Error('API 在 30 秒内未就绪')
}

function proxyApi(request: IncomingMessage, response: ServerResponse, port: number): void {
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${port}` },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', () => {
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ message: 'FF - LLM Wiki API 暂不可用' }))
  })
  request.pipe(upstream)
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  pathname: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }

  const relative = decodeURIComponent(pathname).replace(/^\/+/, '')
  const candidates = relative.length === 0
    ? ['index.html']
    : extname(relative).length > 0
      ? [relative]
      : [`${relative}/index.html`, `${relative}.html`]

  for (const candidate of candidates) {
    const path = resolve(root, candidate)
    if (path !== root && !path.startsWith(`${resolve(root)}${sep}`)) continue
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      const body = await readFile(path)
      const extension = extname(path).toLowerCase()
      response.writeHead(200, {
        'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
        'content-length': body.byteLength,
        'cache-control': candidate.startsWith('_next/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    } catch {
      // Try the next deterministic export path.
    }
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('页面不存在')
}

/** Host dependencies supplied by the DSH Web/Desktop Bundle. */
export const inject = ['webServer', 'credentials']

/** Mount only the launcher route; the product itself runs outside the DSH page shell. */
export function apply(ctx: Context): void {
  const application = new StandaloneApplication(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (request.method === 'GET' && pathname === `${API_PREFIX}/open`) {
        try {
          const url = await application.start()
          response.writeHead(302, { location: url, 'cache-control': 'no-store' })
          response.end()
        } catch (error) {
          response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
          response.end(error instanceof Error ? error.message : String(error))
        }
        return
      }
      if (request.method === 'GET' && pathname === `${API_PREFIX}/status`) {
        const credential = await ctx.credentials.describe(CREDENTIAL_REF)
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ installed: true, credentialConfigured: credential.configured }))
        return
      }
      response.writeHead(404)
      response.end()
    },
  }), 'ff-llm-wiki: standalone launcher')
  ctx.effect(() => async () => { await application.stop() }, 'ff-llm-wiki: standalone lifecycle')
}
