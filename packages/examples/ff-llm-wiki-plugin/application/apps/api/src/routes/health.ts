import type { FastifyPluginAsync } from 'fastify'
import type { HealthResponse } from '@llmwiki/contracts'
import { config } from '../config.js'

/** GET /health —— 服务健康检查。 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      service: config.serviceName,
      version: config.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  })
}
