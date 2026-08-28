import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildServer } from '../src/server.js'
import { buildGraph, extractGraph } from '../src/graph/extractor.js'
import { KG_EDGES_PATH, KG_NODES_PATH } from '../src/graph/paths.js'
import { RAW_DIR } from '../src/wiki/paths.js'

/** 哈希 raw/ 全部源文件，证明抽取/重抽取绝不碰源层 */
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

const NODE_FIELDS = [
  'id',
  'name',
  'type',
  'source_doc',
  'char_start',
  'char_end',
  'confidence',
  'page',
] as const
const EDGE_FIELDS = ['source', 'target', 'relation', 'doc_id', 'page'] as const
const ACCEPTED_ALIGNMENTS = new Set(['match_exact', 'match_greater', 'match_lesser'])

test('抽取：节点/边满足 Skill 数据契约，覆盖四类节点与四种语义边', () => {
  const g = buildGraph()

  // 节点必备字段 + id 唯一 + (name.lower, type) 去重 + confidence 可信
  const ids = new Set<string>()
  const dedup = new Set<string>()
  for (const n of g.nodes) {
    for (const f of NODE_FIELDS) {
      assert.ok(f in n, `节点 ${n.id} 缺字段 ${f}`)
    }
    assert.ok(!ids.has(n.id), `节点 id 重复 ${n.id}`)
    ids.add(n.id)
    assert.match(n.id, /^node_\d+$/)
    assert.ok(ACCEPTED_ALIGNMENTS.has(n.confidence), `低质量对齐未过滤 ${n.confidence}`)
    const key = `${n.name.toLowerCase()}|${n.type}`
    assert.ok(!dedup.has(key), `节点未去重 (name.lower,type)=${key}`)
    dedup.add(key)
  }

  // 边必备字段 + 无孤儿 + 无自环 + relation 恒为 CO_OCCURS_IN
  for (const e of g.edges) {
    for (const f of EDGE_FIELDS) {
      assert.ok(f in e, `边 ${e.source}→${e.target} 缺字段 ${f}`)
    }
    assert.equal(e.relation, 'CO_OCCURS_IN')
    assert.ok(ids.has(e.source), `孤儿边 source=${e.source}`)
    assert.ok(ids.has(e.target), `孤儿边 target=${e.target}`)
    assert.notEqual(e.source, e.target, `自环 ${e.source}`)
  }

  // 节点类型覆盖：知识页 / 来源文档 / 主题 / 页面类型
  assert.deepEqual(
    [...new Set(g.nodes.map(n => n.type))].sort(),
    ['PAGE', 'PAGE_TYPE', 'SOURCE', 'TOPIC'],
  )
  assert.equal(g.nodes.filter(n => n.type === 'PAGE').length, 47)
  assert.equal(g.nodes.filter(n => n.type === 'SOURCE').length, 18)
  assert.equal(g.nodes.filter(n => n.type === 'TOPIC').length, 6)
  assert.equal(g.nodes.filter(n => n.type === 'PAGE_TYPE').length, 4)

  // 边语义覆盖：内链 / 来源 / 主题 / 类型
  assert.deepEqual(
    [...new Set(g.edges.map(e => e.semantic))].sort(),
    ['HAS_SOURCE', 'HAS_TOPIC', 'HAS_TYPE', 'LINKS_TO'],
  )
  assert.equal(g.edges.filter(e => e.semantic === 'LINKS_TO').length, 99)
  assert.equal(g.edges.filter(e => e.semantic === 'HAS_SOURCE').length, 98)
  assert.equal(g.edges.filter(e => e.semantic === 'HAS_TOPIC').length, 47)
  assert.equal(g.edges.filter(e => e.semantic === 'HAS_TYPE').length, 47)

  // 边去重键 (source,target,doc_id,page) 无重复
  const edgeKeys = new Set<string>()
  for (const e of g.edges) {
    const key = `${e.source}|${e.target}|${e.doc_id}|${e.page}`
    assert.ok(!edgeKeys.has(key), `边疑似重复 ${key}`)
    edgeKeys.add(key)
  }
})

test('确定性：相同输入两次 buildGraph 产物完全一致', () => {
  const a = buildGraph()
  const b = buildGraph()
  assert.equal(JSON.stringify(a.nodes), JSON.stringify(b.nodes))
  assert.equal(JSON.stringify(a.edges), JSON.stringify(b.edges))
})

test('落盘：不同时间戳两次抽取，kg_nodes/kg_edges 哈希一致（时间只进 meta）', () => {
  extractGraph(new Date('2026-01-01T00:00:00Z'))
  const h1n = createHash('sha256').update(readFileSync(KG_NODES_PATH)).digest('hex')
  const h1e = createHash('sha256').update(readFileSync(KG_EDGES_PATH)).digest('hex')

  extractGraph(new Date('2026-02-02T00:00:00Z'))
  const h2n = createHash('sha256').update(readFileSync(KG_NODES_PATH)).digest('hex')
  const h2e = createHash('sha256').update(readFileSync(KG_EDGES_PATH)).digest('hex')

  assert.equal(h1n, h2n, 'kg_nodes.json 两次抽取不一致')
  assert.equal(h1e, h2e, 'kg_edges.json 两次抽取不一致')
})

test('抽取绝不改动源层（raw/ 零改动、零新增）', () => {
  const before = hashRaw()
  assert.equal(before.files, 18)

  extractGraph(new Date('2026-01-01T00:00:00Z'))

  const after = hashRaw()
  assert.equal(after.files, 18, 'raw/ 出现新增文件（红线：一件不增）')
  assert.equal(after.digest, before.digest, 'raw/ 源文件被改动（红线：一字不改）')
})

test('GET /api/graph 概览统计全部来自真实输出文件', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/graph' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.mode, 'local-rule-extraction')
    assert.equal(body.stats.nodes, 75)
    assert.equal(body.stats.edges, 291)
    assert.equal(body.stats.pageNodes, 47)
    assert.equal(body.stats.sourceNodes, 18)
    assert.equal(body.stats.topicNodes, 6)
    assert.equal(body.stats.pageTypeNodes, 4)
    assert.ok(body.generatedAt)
    assert.ok(body.sourceManifestCompiledAt)

    // nodeTypes 分布来自真实文件
    const byType = new Map(body.nodeTypes.map((t: { type: string; count: number }) => [t.type, t.count]))
    assert.equal(byType.get('PAGE'), 47)
    assert.equal(byType.get('SOURCE'), 18)
    assert.equal(byType.get('TOPIC'), 6)
    assert.equal(byType.get('PAGE_TYPE'), 4)
  } finally {
    await app.close()
  }
})

test('GET /api/graph/nodes?type=PAGE 只返回知识页节点', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/graph/nodes', query: { type: 'PAGE' } })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.total, 47)
    assert.ok(body.nodes.every((n: { type: string }) => n.type === 'PAGE'))
  } finally {
    await app.close()
  }
})

test('GET /api/graph/edges?semantic=LINKS_TO 只返回内链边', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/graph/edges', query: { semantic: 'LINKS_TO' } })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.total, 99)
    assert.ok(body.edges.every((e: { semantic: string }) => e.semantic === 'LINKS_TO'))
  } finally {
    await app.close()
  }
})

test('POST /api/graph/extract 真实重跑管道并更新生成时间，不碰 raw', async () => {
  const rawBefore = hashRaw()
  const app = await buildServer()
  try {
    const first = await app.inject({ method: 'GET', url: '/api/graph' })
    const t1 = first.json().generatedAt

    await new Promise(r => setTimeout(r, 5))

    const res = await app.inject({ method: 'POST', url: '/api/graph/extract' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.ok, true)
    assert.equal(body.mode, 'local-rule-extraction')
    assert.equal(body.stats.nodes, 75)
    assert.equal(body.stats.edges, 291)

    const second = await app.inject({ method: 'GET', url: '/api/graph' })
    const t2 = second.json().generatedAt
    assert.ok(t2 >= t1, '重新抽取应更新生成时间')

    const rawAfter = hashRaw()
    assert.equal(rawAfter.digest, rawBefore.digest, '重抽取后 raw/ 被改动')
  } finally {
    await app.close()
  }
})
