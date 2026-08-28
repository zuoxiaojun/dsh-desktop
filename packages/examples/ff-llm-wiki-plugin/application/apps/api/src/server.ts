import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { healthRoutes } from './routes/health.js'
import { overviewRoutes } from './routes/overview.js'
import { documentsRoutes } from './routes/documents.js'
import { wikiRoutes } from './routes/wiki.js'
import { graphRoutes } from './routes/graph.js'
import { qaRoutes } from './routes/qa.js'
import { evaluationRoutes } from './routes/evaluation.js'
import { createDemoDocuments, DemoOverviewRepository } from './data/demo.js'
import { SqliteDocumentRepository } from './data/sqlite.js'
import { QaService } from './qa/service.js'
import type { DeepSeekRuntimeConfig } from './qa/deepseek.js'
import { SqliteKnowledgeRepository } from './data/knowledge-sqlite.js'
import { DocumentProcessor } from './documents/processor.js'
import { DynamicWikiPublisher } from './wiki/dynamic.js'

/** 上传文件大小上限：50 MB（与路由层一致） */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface BuildServerOptions {
  /** SQLite 文件路径；测试可传 ":memory:"。缺省为内存库。 */
  dbPath?: string
  /** DeepSeek 运行配置；缺省不带密钥，自动使用本地检索降级。 */
  deepseek?: DeepSeekRuntimeConfig
  /** 原文件、解析文本与分段产物目录；测试缺省使用临时目录。 */
  documentStoragePath?: string
  /** 每个阶段的最短可感知时长；生产 UI 使用，测试可设为 0。 */
  documentStageDelayMs?: number
}

/**
 * 构建 Fastify 应用实例（不监听端口）。
 * 抽离为独立函数便于测试中使用 app.inject() 直接注入请求。
 */
export async function buildServer(
  opts: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  // 允许 Web 前端跨域访问（开发与生产分离部署时均需要）。
  await app.register(cors, { origin: true })

  // multipart 上传：限制单文件 50MB、最多 1 个文件，超限即抛错。
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
    throwFileSizeLimit: true,
  })

  await app.register(healthRoutes)
  await app.register(overviewRoutes(new DemoOverviewRepository()))

  const databasePath = opts.dbPath ?? ':memory:'
  const docRepo = new SqliteDocumentRepository(databasePath)
  const knowledgeRepo = new SqliteKnowledgeRepository(databasePath)
  const qaService = new QaService(
    opts.deepseek ?? {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      credentialSource: 'missing',
    },
    knowledgeRepo,
  )
  qaService.syncKnowledge()
  // 首次启动自动载入演示资料（幂等），保证默认进入即有内容。
  if ((await docRepo.count()) === 0) {
    await docRepo.seed(createDemoDocuments())
  }
  const temporaryStorage = !opts.documentStoragePath
  const documentStoragePath =
    opts.documentStoragePath ?? mkdtempSync(join(tmpdir(), 'llmwiki-documents-'))
  const documentProcessor = new DocumentProcessor(
    docRepo,
    documentStoragePath,
    opts.documentStageDelayMs ?? 0,
    new DynamicWikiPublisher(knowledgeRepo),
  )
  await documentProcessor.publishReadyDocuments()
  await app.register(documentsRoutes(docRepo, documentProcessor))

  // 编译式 Wiki 路由（首次装配即确保编译产物存在）
  await app.register(wikiRoutes(knowledgeRepo))

  // 知识图谱数据地基路由（首次装配即确保 output/ 图谱产物存在）
  await app.register(graphRoutes())

  // 可溯源知识问答：本地检索负责证据，DeepSeek 负责受约束生成。
  await app.register(qaRoutes(qaService))

  // 问答评估报告路由（只读 output/eval/ 真实产物）
  await app.register(evaluationRoutes())

  app.addHook('onClose', async () => {
    await documentProcessor.close()
    docRepo.close()
    knowledgeRepo.close()
    if (temporaryStorage) {
      rmSync(documentStoragePath, { recursive: true, force: true })
    }
  })

  return app
}
