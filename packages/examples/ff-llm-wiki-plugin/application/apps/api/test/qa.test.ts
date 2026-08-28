import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { buildServer } from '../src/server.js'
import { retrieve } from '../src/qa/retriever.js'
import { compileWiki, type WikiManifest } from '../src/wiki/compiler.js'
import type { QaResponse } from '@llmwiki/contracts'

/** 用编译产物（内存态 + 带锁，避免并发 rmSync 读半成品）作为检索语料 */
function compiledManifest(): WikiManifest {
  return compileWiki(new Date('2026-08-16T16:30:33.062Z'))
}

/** 断言答案里每个 [n] 角标都有对应引用，且片段是 manifest 里的真实文本 */
function assertCitationReconciliation(qa: QaResponse, manifest: WikiManifest): void {
  const slugToPage = new Map(manifest.pages.map(p => [p.slug, p]))

  // 答案文本角标集合 == citations.id 集合
  const citedIds = new Set<number>()
  for (const a of qa.answers) {
    for (const m of a.text.matchAll(/\[(\d+)\]/g)) {
      citedIds.add(Number(m[1]))
    }
  }
  for (const c of qa.citations) citedIds.add(c.id)
  assert.equal(citedIds.size, qa.citations.length, '引用编号与答案角标不对账')

  // 每个引用回指真实片段（存在于该页结论或来源证据点）
  for (const c of qa.citations) {
    const page = slugToPage.get(c.pageSlug)
    assert.ok(page, `引用指向不存在的页面 ${c.pageSlug}`)
    const pool =
      c.origin === 'conclusion'
        ? page.conclusion
        : page.sourceEvidence.flatMap(e => e.points)
    assert.ok(pool.includes(c.snippet), `引用片段非真实原文：${c.snippet}`)
  }
}

test('检索：命中「网关」问题返回有证据的结构化回答且引用对账', () => {
  const manifest = compiledManifest()
  const qa = retrieve(manifest, '网关是如何做统一鉴权和限流的？')

  assert.equal(qa.status, 'answered')
  assert.ok(qa.answers.length >= 1, '应有至少一段回答')
  assert.equal(qa.citations.length, qa.answers.length)
  assert.ok(qa.metrics.searched === 47, '检索范围应为 47 篇 Wiki')
  assert.ok(qa.metrics.adopted >= 1)
  assert.equal(qa.mode, 'local-weighted-retrieval')
  assert.ok(qa.compiledAt)

  assertCitationReconciliation(qa, manifest)

  // 命中页应含网关架构相关页
  assert.ok(
    qa.citations.some(c => c.pageSlug.includes('gateway')),
    '应命中网关架构相关页',
  )
})

test('检索：确定性可复现（同一问句两次结果一致）', () => {
  const manifest = compiledManifest()
  const q = 'SLA 的首次响应时限是怎么定义的？'
  const a1 = retrieve(manifest, q)
  const a2 = retrieve(manifest, q)
  assert.deepEqual(a1, a2, '同一问句结果应恒等（可复现检索）')
  assert.equal(a1.status, 'answered')
})

test('检索：无充分证据的问题诚实回答 no_evidence 并附可核查资料', () => {
  const manifest = compiledManifest()
  // 「销售提成」与知识库业务弱相关：有命中但不达采用阈值
  const qa = retrieve(manifest, '销售提成的计算方式是什么？')

  assert.equal(qa.status, 'no_evidence')
  assert.equal(qa.answers.length, 0)
  assert.equal(qa.citations.length, 0)
  assert.equal(qa.confidence, 'low')
  // 仍返回最相近的可核查资料（可点击打开）
  assert.ok(qa.fallback.length > 0, '应返回可核查的最相近资料')
  for (const f of qa.fallback) {
    assert.ok(f.pageSlug && f.pageTitle && f.summary)
  }
})

test('检索：完全零命中的问题返回空兜底（诚实，不编造）', () => {
  const manifest = compiledManifest()
  const qa = retrieve(manifest, '今天食堂周三中午有什么菜呢？')
  assert.equal(qa.status, 'no_evidence')
  assert.equal(qa.metrics.matched, 0)
  assert.equal(qa.fallback.length, 0)
})

test('POST /api/qa 返回结构化回答', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qa',
      payload: { question: '变更生产环境要走什么流程？' },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.status, 'answered')
    assert.ok(body.answers.length >= 1)
    assert.ok(body.citations.length >= 1)
    assertCitationReconciliation(body, compiledManifest())
  } finally {
    await app.close()
  }
})

test('POST /api/qa 简单问候直接返回对话，不误报知识证据不足', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qa',
      payload: { question: '你好' },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.status, 'answered')
    assert.equal(body.citations.length, 0)
    assert.equal(body.fallback.length, 0)
    assert.equal(body.metrics.searched, 0)
    assert.ok(body.answers[0].text.includes('你好'))
  } finally {
    await app.close()
  }
})

test('POST /api/qa 空问题返回 400', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qa',
      payload: { question: '   ' },
    })
    assert.equal(res.statusCode, 400)
  } finally {
    await app.close()
  }
})

test('POST /api/qa/stream 以 SSE 分块逐段返回，首块为 meta、末块为 done', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qa/stream',
      payload: { question: '数据泄露后应该怎么应急？' },
    })
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'] ?? '', /text\/event-stream/)

    const body = res.body as string
    const events = body
      .split('\n\n')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => s.startsWith('data: '))
      .map(s => JSON.parse(s.slice('data: '.length)))

    assert.ok(events.length >= 3, '应有 meta + 至少一回答 + done')
    assert.equal(events[0].type, 'meta')
    assert.equal(events[events.length - 1].type, 'done')
    assert.ok(events.some(e => e.type === 'answer'))
    assert.ok(events.some(e => e.type === 'citations'))
  } finally {
    await app.close()
  }
})

test('POST /api/qa/stream 透传 DeepSeek 增量并以完整答案收口', async () => {
  const provider = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    })
    response.write('data: {"choices":[{"delta":{"content":"请问您想了解"}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"content":"哪方面的三大内容？"}}]}\n\n')
    response.end('data: [DONE]\n\n')
  })

  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject)
    provider.listen(0, '127.0.0.1', () => {
      provider.off('error', reject)
      resolve()
    })
  })

  const address = provider.address()
  assert.ok(address && typeof address !== 'string')
  const app = await buildServer({
    deepseek: {
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}`,
      defaultModel: 'deepseek-v4-flash',
      credentialSource: 'environment',
    },
  })

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qa/stream',
      payload: { question: '三大', model: 'deepseek-v4-flash' },
    })
    const events = (res.body as string)
      .split('\n\n')
      .map(part => part.trim())
      .filter(part => part.startsWith('data: '))
      .map(part => JSON.parse(part.slice('data: '.length)))

    assert.deepEqual(
      events.filter(event => event.type === 'delta').map(event => event.text),
      ['请问您想了解', '哪方面的三大内容？'],
    )
    const completed = events.find(event => event.type === 'answer_complete')
    assert.equal(completed.answers[0].text, '请问您想了解哪方面的三大内容？')
    assert.equal(completed.answers[0].citations.length, 0)
    assert.equal(events.at(-1).type, 'done')
  } finally {
    await app.close()
    await new Promise<void>((resolve, reject) =>
      provider.close(error => (error ? reject(error) : resolve())),
    )
  }
})
