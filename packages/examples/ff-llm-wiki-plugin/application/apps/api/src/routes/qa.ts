import type { FastifyPluginAsync } from 'fastify'
import type { QaModelId, QaRequest, QaResponse } from '@llmwiki/contracts'
import { QaService } from '../qa/service.js'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 可溯源知识问答 API：先做确定性检索，再由 DeepSeek 基于证据生成答案。
 * API Key 始终停留在服务端；前端只读取脱敏配置和连接结果。
 */
export function qaRoutes(service: QaService): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/qa/config', async () => service.getModelConfig())

    app.post<{ Body: { model?: QaModelId } }>('/api/qa/config/test', async (req) => {
      const config = service.getModelConfig()
      return service.testConnection(req.body?.model ?? config.defaultModel)
    })

    app.post<{ Body: QaRequest }>(
      '/api/qa',
      async (req, reply): Promise<QaResponse> => {
        const question = req.body?.question
        if (!question || !question.trim()) {
          return reply.code(400).send({ message: 'question 不能为空' })
        }
        return service.answer({ ...req.body, question: question.trim() })
      },
    )

    app.post<{ Body: QaRequest }>('/api/qa/stream', async (req, reply) => {
      const question = req.body?.question
      if (!question || !question.trim()) {
        return reply.code(400).send({ message: 'question 不能为空' })
      }

      const request: QaRequest = { ...req.body, question: question.trim() }
      const retrieval = service.retrieve(request.question)
      const modelConfig = service.getModelConfig()
      const origin = req.headers.origin ?? '*'
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      })

      const send = (payload: unknown) => {
        if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      send({
        type: 'meta',
        status: retrieval.status,
        confidence: retrieval.confidence,
        metrics: retrieval.metrics,
        compiledAt: retrieval.compiledAt,
        mode:
          request.generationMode === 'local'
            ? 'local-weighted-retrieval'
            : retrieval.status === 'no_evidence' && modelConfig.configured
              ? 'deepseek-chat'
              : 'deepseek-rag',
        model: request.model ?? modelConfig.defaultModel,
        providerConfigured: modelConfig.configured,
      })

      let receivedProviderDelta = false
      const result = await service.answer(request, retrieval, (text) => {
        receivedProviderDelta = true
        send({ type: 'delta', text })
      })
      send({ type: 'generation', generation: result.generation, mode: result.mode })

      if (receivedProviderDelta) {
        send({ type: 'answer_complete', answers: result.answers })
      } else {
        for (const answer of result.answers) {
          send({ type: 'answer', answer })
          await wait(24)
        }
      }
      if (result.citations.length > 0) send({ type: 'citations', citations: result.citations })
      if (result.fallback.length > 0) send({ type: 'fallback', fallback: result.fallback })
      send({ type: 'done' })
      reply.raw.end()
    })
  }
}
