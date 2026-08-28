import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/server.js'

test('GET /health 返回 ok 状态', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.service, 'llmwiki-api')
    assert.equal(typeof body.uptime, 'number')
    assert.ok(body.timestamp)
  } finally {
    await app.close()
  }
})

test('GET /api/overview 返回首页总览数据', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/overview' })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.stats.length, 4)
    assert.ok(body.recentDocuments.length > 0)
    assert.ok(body.processingProgress.length > 0)
    assert.ok(body.generatedAt)
  } finally {
    await app.close()
  }
})

test('未知路由返回 404', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/nope' })
    assert.equal(res.statusCode, 404)
  } finally {
    await app.close()
  }
})
