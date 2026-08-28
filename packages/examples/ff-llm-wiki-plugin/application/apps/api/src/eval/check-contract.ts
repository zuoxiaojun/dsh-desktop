import { EVALUATORS } from './evaluators.js'

/**
 * 评估器返回契约自检（STAGE-09）
 *
 * 等价于 Skill 的 check_evaluator_contract.py，但对 TS 评估器做「真实运行时」校验
 * （原脚本是 Python AST 静态分析，无法导入本项目 TS 评估器）：
 *   ① 每个评估器返回对象含 key/score/comment 三字段；
 *   ② score 类型合法（null 或 number）；
 *   ③ 「无 null 分支」仅作 warning——有的评估器语义上对所有用例恒适用
 *      （如 answer_completed / input_robust），不强制其存在 null 分支。
 *
 * 通过构造「期望 answered + 期望 no_evidence」两类上下文真实调用评估器函数来验证。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EvalCase, QaResponse } from '@llmwiki/contracts'
import type { WikiManifest } from '../wiki/compiler.js'
import { findRepoRoot, WIKI_DIR } from '../wiki/paths.js'
import { retrieve } from '../qa/retriever.js'
import { EVAL_CASES } from './cases.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = findRepoRoot(MODULE_DIR)

function manifest(): WikiManifest {
  const p = join(WIKI_DIR, 'manifest.json')
  if (!existsSync(p)) throw new Error('缺少 manifest.json')
  return JSON.parse(readFileSync(p, 'utf8')) as WikiManifest
}

const m = manifest()

/** 对每个评估器构造最小上下文：验证其返回结构 + score 合法性 + 记录 null 分支 */
function checkContract(): { errors: string[]; warnings: string[]; checked: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const checked: string[] = []

  // 找一个「期望 answered」用例和一个「期望 no_evidence」用例做真实上下文
  const answeredCase = EVAL_CASES.find(c => c.expectStatus === 'answered') as EvalCase
  const noEvCase = EVAL_CASES.find(c => c.expectStatus === 'no_evidence') as EvalCase

  for (const [name, fn] of Object.entries(EVALUATORS)) {
    checked.push(name)
    const ctxA = { question: answeredCase.question, c: answeredCase, qa: retrieve(m, answeredCase.question.trim()), manifest: m }
    const ctxB = { question: noEvCase.question, c: noEvCase, qa: retrieve(m, noEvCase.question.trim()), manifest: m }

    for (const [label, ctx] of [['适用(answered)', ctxA], ['no_evidence 上下文', ctxB]] as const) {
      let out: unknown
      try {
        out = fn(ctx)
      } catch (e) {
        errors.push(`${name}(${label}) 抛异常：${String(e)}`)
        continue
      }
      if (!out || typeof out !== 'object') {
        errors.push(`${name}(${label}) 返回值非对象：${String(out)}`)
        continue
      }
      const item = out as Record<string, unknown>
      const keys = Object.keys(item).sort().join(',')
      if (keys !== 'comment,key,score') {
        errors.push(`${name}(${label}) 返回字段不齐：{${keys}}（须 key/score/comment）`)
      }
      if (!(item.score === null || typeof item.score === 'number')) {
        errors.push(`${name}(${label}) score 类型非法：${typeof item.score}`)
      }
    }

    // 无 null 分支仅作 warning：恒适用评估器（answer_completed / input_robust）合法。
    const all = [fn(ctxA), fn(ctxB)]
    if (!all.some(s => s.score === null)) {
      warnings.push(`${name} 未见 score=null 分支（若语义恒适用则合法；否则应返回 null 跳过）`)
    }
  }
  return { errors, warnings, checked }
}

const { errors, warnings, checked } = checkContract()
if (errors.length > 0) {
  console.error('评估器契约自检失败：')
  for (const e of errors) console.error(`  ❌ ${e}`)
  process.exit(1)
}
if (warnings.length > 0) {
  console.log('契约 warning（非阻断）：')
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}
console.log(`评估器契约自检通过：${checked.length} 个评估器均返回 {key,score,comment}，score 类型合法 ✔`)
console.log(`  （repo=${REPO_ROOT}，真实调用评估器函数校验，非静态声明）`)
