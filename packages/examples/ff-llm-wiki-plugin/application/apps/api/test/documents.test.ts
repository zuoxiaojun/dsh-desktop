import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/server.js'

const BOUNDARY = '----llmwiki-test-boundary'

/** 构造一份 multipart/form-data 请求体（单文件字段）。 */
function multipartBody(
  filename: string,
  content: string | Buffer,
  fieldName = 'file',
): Buffer {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8')
  return Buffer.concat([head, body, tail])
}

const multipartHeaders = () => ({
  'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
})

async function waitUntilReady(app: Awaited<ReturnType<typeof buildServer>>, documentId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/documents/${documentId}/processing`,
    })
    if (response.json().job?.status === 'ready') return response.json()
    if (response.json().job?.status === 'failed') throw new Error(response.json().job.error)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('等待资料处理完成超时')
}

test('首次构建自动载入 128 条演示资料，统计一致', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/documents' })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.total, 128)
    assert.equal(body.items.length, 10) // 默认每页 10 条
    assert.equal(body.page, 1)
    assert.equal(body.totalPages, 13)

    // 确定性状态分布（证明种子可追溯、可重复）
    assert.deepEqual(body.stats, {
      total: 128,
      ready: 97,
      processing: 10,
      queued: 13,
      failed: 8,
    })
  } finally {
    await app.close()
  }
})

test('搜索关键词可命中唯一资料', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { search: '数据泄露' },
    })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.total, 1)
    assert.equal(body.items[0].title, '数据泄露应急预案')
    assert.equal(body.items[0].status, 'failed')
    // 统计仍为全量统计，不受搜索影响
    assert.equal(body.stats.total, 128)
  } finally {
    await app.close()
  }
})

test('状态筛选：failed 返回全部异常记录', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { status: 'failed' },
    })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.total, 8)
    assert.ok(body.items.every((d: { status: string }) => d.status === 'failed'))
  } finally {
    await app.close()
  }
})

test('分页：第二页返回 10 条且字段正确', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { page: '2', pageSize: '10' },
    })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.page, 2)
    assert.equal(body.pageSize, 10)
    assert.equal(body.items.length, 10)
    assert.equal(body.total, 128)
  } finally {
    await app.close()
  }
})

test('载入演示资料幂等：重复调用不产生重复数据', async () => {
  const app = await buildServer()
  try {
    const first = await app.inject({
      method: 'POST',
      url: '/api/documents/demo-seed',
    })
    assert.equal(first.statusCode, 200)
    // 首次构建已自动载入，因此本次全部跳过
    assert.deepEqual(first.json(), { ok: true, seeded: 0, skipped: 128, total: 128 })

    const list = await app.inject({ method: 'GET', url: '/api/documents' })
    assert.equal(list.json().total, 128)
  } finally {
    await app.close()
  }
})

test('上传 TXT：校验通过后进入待处理队列', async () => {
  const app = await buildServer()
  try {
    const content = '这是一份用于测试导入的资料内容。'
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload: multipartBody('产品说明书-上传测试.txt', content),
    })
    assert.equal(res.statusCode, 201)

    const body = res.json()
    assert.equal(body.ok, true)
    assert.equal(body.duplicate, false)
    assert.equal(body.document.kind, 'txt')
    assert.equal(body.document.origin, 'upload')
    assert.equal(body.document.status, 'queued')
    assert.equal(body.document.title, '产品说明书-上传测试')
    assert.equal(body.document.sizeBytes, Buffer.byteLength(content, 'utf8'))
    assert.equal(body.document.sha256.length, 64)

    // 上传后总数 +1
    const list = await app.inject({ method: 'GET', url: '/api/documents' })
    assert.equal(list.json().total, 129)
  } finally {
    await app.close()
  }
})

test('上传 TXT：真实完成解析、分段与 SQLite 入库并暴露阶段进度', async () => {
  const app = await buildServer({ documentStageDelayMs: 0 })
  try {
    const content = Array.from(
      { length: 30 },
      (_, index) => `第 ${index + 1} 条知识：生产变更必须经过审批、灰度验证和回滚检查。`,
    ).join('\n')
    const upload = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload: multipartBody('生产变更知识.txt', content),
    })
    assert.equal(upload.statusCode, 201)
    const documentId = upload.json().document.id as string

    let processing
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/documents/${documentId}/processing`,
      })
      assert.equal(response.statusCode, 200)
      processing = response.json()
      if (processing.job.status === 'ready' || processing.job.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    assert.equal(processing.job.status, 'ready')
    assert.equal(processing.document.status, 'ready')
    assert.equal(processing.job.progress, 100)
    assert.ok(processing.job.extractedChars >= content.length - 2)
    assert.ok(processing.job.chunkCount >= 1)
    assert.ok(processing.job.stages.every((stage: { status: string }) => stage.status === 'done'))
  } finally {
    await app.close()
  }
})

test('文档 → Wiki → 问答链路：自动发布、更新置前、筛选与级联删除', async () => {
  const app = await buildServer({ documentStageDelayMs: 0 })
  try {
    const knowledgeLines = Array.from(
      { length: 16 },
      (_, index) =>
        `北极星熔断协议第 ${index + 1} 条：发现连续三次健康检查失败后，应立即冻结发布、通知安全负责人并执行蓝绿回滚。`,
    ).join('\n')
    const content = `# 北极星熔断操作手册\n\n**核心处置规则**\n\n${knowledgeLines}\n\n## 处置矩阵\n\n| 场景 | 动作 |\n| --- | --- |\n| 连续失败 | 冻结发布并执行回滚 |\n\n\`\`\`text\n├── 这段目录树不应进入 Wiki 正文\n\`\`\``
    const upload = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload: multipartBody('北极星熔断操作手册.txt', content),
    })
    assert.equal(upload.statusCode, 201)
    const documentId = upload.json().document.id as string
    await waitUntilReady(app, documentId)

    const detail = await app.inject({ method: 'GET', url: `/api/documents/${documentId}` })
    assert.equal(detail.statusCode, 200)
    assert.ok(detail.json().extractedText.includes('北极星熔断协议'))
    assert.ok(detail.json().chunks.length >= 1)
    assert.equal(detail.json().wikiPages.length, 1)

    const wiki = await app.inject({ method: 'GET', url: '/api/wiki' })
    assert.equal(wiki.json().stats.pages, 48)
    assert.equal(wiki.json().pages[0].sourceDocumentId, documentId)
    assert.equal(wiki.json().pages[0].isDynamic, true)
    const slug = wiki.json().pages[0].slug as string
    const wikiDetail = await app.inject({ method: 'GET', url: `/api/wiki/${slug}` })
    const compiledText = wikiDetail.json().conclusion.join(' ') as string
    assert.doesNotMatch(compiledText, /(?:\*\*|^#|```|├──|\| ---)/m)
    assert.match(compiledText, /北极星熔断协议/)

    const qa = await app.inject({
      method: 'POST',
      url: '/api/qa',
      payload: { question: '北极星熔断协议发现健康检查失败后怎么办？', generationMode: 'local' },
    })
    assert.equal(qa.statusCode, 200)
    assert.ok(
      qa.json().citations.some(
        (citation: { pageSlug: string }) => citation.pageSlug === slug,
      ),
    )

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/documents/${documentId}`,
      payload: { title: '北极星生产熔断手册', topic: 'security', source: '安全运营中心' },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().document.topic, 'security')
    assert.equal(updated.json().wikiPages[0].title, '北极星生产熔断手册')

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { kind: 'txt', topic: 'security', origin: 'upload' },
    })
    assert.ok(filtered.json().items.some((item: { id: string }) => item.id === documentId))

    const removed = await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}` })
    assert.equal(removed.statusCode, 200)
    assert.deepEqual(removed.json().removedWikiSlugs, [slug])
    assert.equal((await app.inject({ method: 'GET', url: `/api/documents/${documentId}` })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: `/api/wiki/${slug}` })).statusCode, 404)
  } finally {
    await app.close()
  }
})

test('重复上传同一文件：命中 sha256 返回重复提示', async () => {
  const app = await buildServer()
  try {
    const content = '同一份内容，重复导入应该被识别。'
    const payload = multipartBody('客户回访记录.txt', content)

    const first = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload,
    })
    assert.equal(first.statusCode, 201)

    const second = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload, // 相同内容，即使文件名不同也应命中重复
    })
    assert.equal(second.statusCode, 200)

    const body = second.json()
    assert.equal(body.ok, true)
    assert.equal(body.duplicate, true)
    assert.ok(body.existingId)
    assert.equal(body.document.id, body.existingId)

    // 总数不因重复上传而增加
    const list = await app.inject({ method: 'GET', url: '/api/documents' })
    assert.equal(list.json().total, 129)
  } finally {
    await app.close()
  }
})

test('上传不支持的扩展名返回 400', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload: multipartBody('恶意脚本.exe', 'not allowed'),
    })
    assert.equal(res.statusCode, 400)
    assert.equal(res.json().ok, false)
  } finally {
    await app.close()
  }
})

test('上传空文件返回 400', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      headers: multipartHeaders(),
      payload: multipartBody('空文件.txt', ''),
    })
    assert.equal(res.statusCode, 400)
    assert.equal(res.json().ok, false)
  } finally {
    await app.close()
  }
})

test('重新处理：异常资料真实变为处理中', async () => {
  const app = await buildServer()
  try {
    // 种子中 doc-0008 为异常记录
    const before = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { search: '数据泄露' },
    })
    assert.equal(before.json().items[0].status, 'failed')

    const res = await app.inject({
      method: 'POST',
      url: '/api/documents/doc-0008/reprocess',
    })
    assert.equal(res.statusCode, 200)

    const body = res.json()
    assert.equal(body.ok, true)
    assert.equal(body.document.status, 'processing')
    assert.equal(body.document.progress, 0)
    assert.equal(body.document.error, null)

    // 重新查询确认状态已持久化变更
    const after = await app.inject({
      method: 'GET',
      url: '/api/documents',
      query: { search: '数据泄露' },
    })
    assert.equal(after.json().items[0].status, 'processing')
  } finally {
    await app.close()
  }
})

test('重新处理不存在的资料返回 404', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents/doc-9999/reprocess',
    })
    assert.equal(res.statusCode, 404)
    assert.equal(res.json().ok, false)
  } finally {
    await app.close()
  }
})
