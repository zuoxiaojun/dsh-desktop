import type { FastifyPluginAsync } from 'fastify'
import type {
  WikiListResponse,
  WikiPageDetail,
  WikiQuery,
  WikiRecompileResult,
} from '@llmwiki/contracts'
import {
  ensureWikiCompiled,
  getWikiPage,
  listWiki,
  recompileWiki,
} from '../wiki/service.js'
import type { SqliteKnowledgeRepository } from '../data/knowledge-sqlite.js'

/**
 * 编译式 Wiki API。
 *
 * - GET  /api/wiki             列表 + 搜索 + 类型筛选
 * - GET  /api/wiki/:slug       单页详情
 * - POST /api/wiki/recompile   重新编译（真实更新产物，不碰 raw/）
 */
export function wikiRoutes(knowledgeRepo: SqliteKnowledgeRepository): FastifyPluginAsync {
  return async (app) => {
    // 装配即确保产物存在，默认进入即装满。
    ensureWikiCompiled()

    app.get<{ Querystring: WikiQuery }>(
      '/api/wiki',
      async (req): Promise<WikiListResponse> => {
        return listWiki(req.query ?? {}, knowledgeRepo.loadManifest())
      },
    )

    app.get<{ Params: { slug: string } }>(
      '/api/wiki/:slug',
      async (req, reply): Promise<WikiPageDetail> => {
        const page = getWikiPage(req.params.slug, knowledgeRepo.loadManifest())
        if (!page) {
          return reply.code(404).send({
            message: `未找到知识页「${req.params.slug}」`,
          })
        }
        return page
      },
    )

    app.post('/api/wiki/recompile', async (): Promise<WikiRecompileResult> => {
      return recompileWiki(knowledgeRepo)
    })
  }
}
