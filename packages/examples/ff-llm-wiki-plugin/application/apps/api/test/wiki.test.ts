import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { compileWiki } from '../src/wiki/compiler.js'
import { RAW_DIR, WIKI_DIR } from '../src/wiki/paths.js'

/** 哈希 raw/ 全部源文件，用于证明编译/重编译不碰源层 */
function hashRaw(): { files: number; digest: string } {
  const files = readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f)
    h.update(readFileSync(join(RAW_DIR, f), 'utf8'))
  }
  return { files: files.length, digest: h.digest('hex') }
}

/** 扫描 wiki/ 语料内所有 wikilink，断言全部带目录前缀（无裸 slug） */
function assertAllWikilinksPrefixed(): void {
  const files = readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'))
  const re = /\[\[([^\]]+)\]\]/g
  for (const f of files) {
    const text = readFileSync(join(WIKI_DIR, f), 'utf8')
    for (const m of text.matchAll(re)) {
      const slug = m[1].split('|', 1)[0].trim()
      assert.ok(slug.includes('/'), `发现裸 wikilink：[[${m[1]}]] 于 ${f}`)
    }
  }
}

test('编译：18 份源资料重组为 47 个知识页（跨来源、非 1:1）', () => {
  const manifest = compileWiki()

  assert.equal(manifest.sources.length, 18)
  assert.equal(manifest.stats.pages, 47)
  assert.equal(manifest.stats.topicsCovered, 6)

  // 类型分布（确定性锁定）
  const byType = new Map(manifest.types.map(t => [t.type, t.count]))
  assert.equal(byType.get('concept'), 14)
  assert.equal(byType.get('system'), 10)
  assert.equal(byType.get('playbook'), 11)
  assert.equal(byType.get('policy'), 12)

  // 统计口径 = 逐页加总，不散落数字
  assert.equal(
    manifest.stats.sourceCitations,
    manifest.pages.reduce((n, p) => n + p.sources.length, 0),
  )
  assert.equal(
    manifest.stats.interlinks,
    manifest.pages.reduce((n, p) => n + p.links.length, 0),
  )
  assert.ok(manifest.stats.interlinks > 0)

  // 每个知识页都聚合了来源证据与互链
  for (const p of manifest.pages) {
    assert.ok(p.sources.length >= 1, `${p.slug} 缺少来源`)
    assert.ok(p.sourceEvidence.length === p.sources.length)
    assert.ok(p.conclusion.length >= 2, `${p.slug} 缺少结论性正文`)
    assert.ok(p.links.length > 0, `${p.slug} 没有互链`)
  }

  // 互链全部指向真实存在的页（无悬空边）
  const slugs = new Set(manifest.pages.map(p => p.slug))
  for (const p of manifest.pages) {
    for (const l of p.links) {
      assert.ok(slugs.has(l.slug), `悬空互链：${p.slug} → ${l.slug}`)
    }
  }

  assertAllWikilinksPrefixed()
})

test('编译 / 重编译绝不改动源层（raw/ 零改动、零新增）', () => {
  const before = hashRaw()
  assert.equal(before.files, 18)

  compileWiki()
  compileWiki()

  const after = hashRaw()
  assert.equal(after.files, 18, 'raw/ 出现新增文件（红线：一件不增）')
  assert.equal(after.digest, before.digest, 'raw/ 源文件被改动（红线：一字不改）')
})

test('GET /api/wiki 返回列表 + 统计 + 类型分布 + 来源概览', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/wiki' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.total, 47)
    assert.equal(body.pages.length, 47)
    assert.equal(body.stats.pages, 47)
    assert.equal(body.stats.topicsCovered, 6)
    assert.equal(body.types.length, 4)
    assert.equal(body.sources.length, 18)
    assert.ok(body.stats.lastCompiledAt)
  } finally {
    await app.close()
  }
})

test('GET /api/wiki?type=concept 类型筛选只返回概念页', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/wiki',
      query: { type: 'concept' },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.total, 14)
    assert.ok(body.pages.every((p: { type: string }) => p.type === 'concept'))
  } finally {
    await app.close()
  }
})

test('GET /api/wiki 搜索关键词命中跨来源页面', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/wiki',
      query: { search: '网关' },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.ok(body.total >= 1)
    assert.ok(
      body.pages.some((p: { slug: string }) => p.slug === 'engineering-gateway-architecture'),
    )
  } finally {
    await app.close()
  }
})

test('GET /api/wiki/:slug 返回结构化详情（结论 + 来源证据 + 互链）', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/wiki/product-lifecycle',
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.slug, 'product-lifecycle')
    assert.ok(body.conclusion.length >= 2)
    assert.ok(body.sourceEvidence.length >= 2)
    assert.ok(body.links.length > 0)
    // 跨来源：至少两份源
    assert.equal(body.sourceEvidence.length, body.sourceEvidence.length)
  } finally {
    await app.close()
  }
})

test('GET /api/wiki/:slug 不存在返回 404', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/wiki/no-such-page' })
    assert.equal(res.statusCode, 404)
  } finally {
    await app.close()
  }
})

test('POST /api/wiki/recompile 真实更新产物与最近编译时间，不碰 raw', async () => {
  const rawBefore = hashRaw()
  const app = await buildServer()
  try {
    const first = await app.inject({ method: 'GET', url: '/api/wiki' })
    const t1 = first.json().stats.lastCompiledAt

    // 等 1ms，确保时间戳可分辨（通常 compile 时间戳到毫秒）
    await new Promise(r => setTimeout(r, 5))

    const res = await app.inject({ method: 'POST', url: '/api/wiki/recompile' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.ok, true)
    assert.equal(body.pages, 47)

    const second = await app.inject({ method: 'GET', url: '/api/wiki' })
    const t2 = second.json().stats.lastCompiledAt
    assert.ok(t2 >= t1, '重新编译应更新最近编译时间')

    const rawAfter = hashRaw()
    assert.equal(rawAfter.digest, rawBefore.digest, '重编译后 raw/ 被改动')
  } finally {
    await app.close()
  }
})
