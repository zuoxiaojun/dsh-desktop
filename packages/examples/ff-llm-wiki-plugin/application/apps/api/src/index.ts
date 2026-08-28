import { buildServer } from './server.js'
import { config } from './config.js'

const app = await buildServer({
  dbPath: config.databasePath,
  deepseek: config.deepseek,
  documentStoragePath: config.documentStoragePath,
  documentStageDelayMs: config.documentStageDelayMs,
})

try {
  await app.listen({ port: config.port, host: config.host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
