import type { FastifyPluginAsync } from 'fastify'
import type { EvalLatestResponse } from '@llmwiki/contracts'
import { getLatestEval } from '../eval/service.js'

/**
 * 问答评估报告 API。
 *
 * - GET /api/evaluation/latest  最近一次真实评估报告（含基线与优化前后对比）
 *
 * 数据来源：output/eval/*.json 真实产物；对比由 Skill eval_score_aggregate.py
 * --compare 真实产出（见根 package.json 的 eval:qa）。前端据实展示，无产物则空态。
 */
export function evaluationRoutes(): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/evaluation/latest', async (): Promise<EvalLatestResponse> => {
      return getLatestEval()
    })
  }
}
