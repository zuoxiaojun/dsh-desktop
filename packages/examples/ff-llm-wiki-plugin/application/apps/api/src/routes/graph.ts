import type { FastifyPluginAsync } from 'fastify'
import type {
  GraphEdgeSemantic,
  GraphEdgesResponse,
  GraphExtractResult,
  GraphNodeType,
  GraphNodesResponse,
  GraphOverviewResponse,
} from '@llmwiki/contracts'
import {
  ensureGraphExtracted,
  getGraphOverview,
  listGraphEdges,
  listGraphNodes,
  reextractGraph,
} from '../graph/service.js'

/**
 * 知识图谱数据地基 API。
 *
 * - GET  /api/graph           图谱概览（统计从真实输出文件计算）
 * - GET  /api/graph/nodes     节点列表（可按 type 筛选）
 * - GET  /api/graph/edges     边列表（可按 semantic 筛选）
 * - POST /api/graph/extract   重新抽取（真实重跑本地规则管道，不碰 raw/）
 */
export function graphRoutes(): FastifyPluginAsync {
  return async (app) => {
    // 装配即确保产物存在，默认进入即装满。
    ensureGraphExtracted()

    app.get('/api/graph', async (): Promise<GraphOverviewResponse> => {
      return getGraphOverview()
    })

    app.get<{ Querystring: { type?: GraphNodeType } }>(
      '/api/graph/nodes',
      async (req): Promise<GraphNodesResponse> => {
        return listGraphNodes(req.query?.type)
      },
    )

    app.get<{ Querystring: { semantic?: GraphEdgeSemantic } }>(
      '/api/graph/edges',
      async (req): Promise<GraphEdgesResponse> => {
        return listGraphEdges(req.query?.semantic)
      },
    )

    app.post('/api/graph/extract', async (): Promise<GraphExtractResult> => {
      return reextractGraph()
    })
  }
}
