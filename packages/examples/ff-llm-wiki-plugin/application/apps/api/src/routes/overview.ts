import type { FastifyPluginAsync } from 'fastify'
import type { OverviewResponse } from '@llmwiki/contracts'
import type { OverviewRepository } from '../data/repository.js'

/** 依据数据仓储构建首页总览路由。 */
export function overviewRoutes(repo: OverviewRepository): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/overview', async (): Promise<OverviewResponse> => {
      return repo.getOverview()
    })
  }
}
