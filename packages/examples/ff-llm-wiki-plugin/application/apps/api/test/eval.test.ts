import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/server.js'
import { retrieve } from '../src/qa/retriever.js'
import { compileWiki, type WikiManifest } from '../src/wiki/compiler.js'
import { EVAL_CASES } from '../src/eval/cases.js'
import { evaluateCase, EVALUATORS } from '../src/eval/evaluators.js'
import { EVAL_NOW } from '../src/eval/runner.js'

function compiledManifest(): WikiManifest {
  return compileWiki(new Date('2026-08-16T16:30:33.062Z'))
}

test('题库：不少于 12 条，全部覆盖六类输入形态且写有期望 page/source/topic', () => {
  assert.ok(EVAL_CASES.length >= 12, '题库至少 12 条')
  const kinds = new Set(EVAL_CASES.map(c => c.kind))
  for (const k of ['direct_fact', 'cross_source', 'concept_link', 'citation_jump', 'no_evidence', 'adversarial'] as const) {
    assert.ok(kinds.has(k), `缺少题型 ${k}`)
  }
  for (const c of EVAL_CASES) {
    assert.ok(c.id && c.question && c.expectStatus, `用例 ${c.id} 缺基础字段`)
    if (c.expectStatus === 'answered') {
      assert.ok(c.expectPageSlugs && c.expectPageSlugs.length > 0, `用例 ${c.id} 期望有答案但未写期望页`)
    }
  }
})

test('评估器契约：每个评估器返回 {key,score,comment} 且 score 为 null 或 number', () => {
  const manifest = compiledManifest()
  const answered = EVAL_CASES.find(c => c.expectStatus === 'answered')!
  const noEv = EVAL_CASES.find(c => c.expectStatus === 'no_evidence')!
  for (const [name, fn] of Object.entries(EVALUATORS)) {
    for (const c of [answered, noEv]) {
      const qa = retrieve(manifest, c.question.trim())
      const out = fn({ question: c.question, c, qa, manifest })
      assert.equal(typeof out.key, 'string', `${name}.key`)
      assert.ok(out.score === null || typeof out.score === 'number', `${name}.score 类型`)
      assert.equal(typeof out.comment, 'string', `${name}.comment`)
    }
  }
})

test('评估器：不适用样本返回 score=null 而非 0（不污染分母）', () => {
  const manifest = compiledManifest()
  const noEv = EVAL_CASES.find(c => c.expectStatus === 'no_evidence')!
  const qa = retrieve(manifest, noEv.question.trim())
  const scores = evaluateCase({ question: noEv.question, c: noEv, qa, manifest })
  // 对 no_evidence 用例，retrieval_hit / evidence_coverage / citation_valid / answer_faithful 应返回 null
  const nullKeys = new Set(scores.filter(s => s.score === null).map(s => s.key))
  for (const k of ['retrieval_hit', 'evidence_coverage', 'citation_valid', 'answer_faithful']) {
    assert.ok(nullKeys.has(k), `${k} 对无证据用例应返回 null`)
  }
  // no_answer_honest 对该用例适用，应给 1（诚实）
  const honest = scores.find(s => s.key === 'no_answer_honest')!
  assert.equal(honest.score, 1)
})

test('检索 profile：diversity=false（baseline）只采纳原 top-5，不补多样性', () => {
  const manifest = compiledManifest()
  const qa = retrieve(manifest, '生产环境变更需要走哪些门禁？', { diversity: false })
  assert.equal(qa.status, 'answered')
  assert.ok(qa.citations.length <= 5, 'baseline 不应超过 top-5')
  // baseline 单页垄断：所有引用应集中在单个页面
  const slugs = new Set(qa.citations.map(c => c.pageSlug))
  assert.equal(slugs.size, 1, 'baseline（无多样性）应单页垄断')
})

test('检索 profile：diversity=true（优化默认）增量补充跨页多样性，且不删原 top-5', () => {
  const manifest = compiledManifest()
  const qa = retrieve(manifest, '生产环境变更需要走哪些门禁？', { diversity: true })
  assert.equal(qa.status, 'answered')
  assert.ok(qa.citations.length <= 8, '优化后引用不超过 diversity cap')
  // 多个不同页面进入引用，体现多样性
  const slugs = new Set(qa.citations.map(c => c.pageSlug))
  assert.ok(slugs.size >= 2, '优化后应命中多个相关页')
  // 前 5 条（原 top-5）必须被保留（增量不替换）
  assert.ok(qa.citations.length >= 5)
})

test('检索 profile：默认行为 = optimized（diversity 未传时开启）', () => {
  const manifest = compiledManifest()
  const withDefault = retrieve(manifest, '生产环境变更需要走哪些门禁？')
  const withOpt = retrieve(manifest, '生产环境变更需要走哪些门禁？', { diversity: true })
  assert.deepEqual(withDefault, withOpt, '默认行为应等同 optimized profile')
})

test('评估 runner：EVAL_NOW 恒为固定常量', () => {
  assert.equal(EVAL_NOW, '2026-08-16T12:00:00.000Z')
})

test('GET /api/evaluation/latest 返回真实报告结构', async () => {
  const app = await buildServer()
  try {
    const res = await app.inject({ method: 'GET', url: '/api/evaluation/latest' })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    // report / baseline / comparison 字段必须存在（值为 null 或对象）
    assert.ok('report' in body, '应含 report 字段')
    assert.ok('baseline' in body, '应含 baseline 字段')
    assert.ok('comparison' in body, '应含 comparison 字段')
  } finally {
    await app.close()
  }
})
