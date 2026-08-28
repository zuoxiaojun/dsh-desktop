import { existsSync, readFileSync } from 'node:fs'
import type { QaModelId } from '@llmwiki/contracts'
import type { DeepSeekRuntimeConfig } from './qa/deepseek.js'

interface CredentialFileEntry {
  key: string
  baseUrl: string
}

function unquote(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * 只读取凭证中心 api_keys.deepseek 下的 key/base_url。
 * 使用小范围解析器可避免把整个敏感 YAML 对象加载、打印或传到业务层。
 */
function readDeepSeekCredential(path: string | undefined): CredentialFileEntry | null {
  if (!path || !existsSync(path)) return null
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    let inApiKeys = false
    let inDeepSeek = false
    let key = ''
    let baseUrl = ''

    for (const line of lines) {
      if (/^api_keys:\s*(?:#.*)?$/.test(line)) {
        inApiKeys = true
        inDeepSeek = false
        continue
      }
      if (inApiKeys && /^\S/.test(line) && !/^api_keys:/.test(line)) break
      if (inApiKeys && /^\s{2}deepseek:\s*(?:#.*)?$/.test(line)) {
        inDeepSeek = true
        continue
      }
      if (inDeepSeek && /^\s{2}\S/.test(line) && !/^\s{4}/.test(line)) break
      if (!inDeepSeek) continue

      const match = line.match(/^\s{4}(key|base_url):\s*(.*?)\s*(?:#.*)?$/)
      if (!match) continue
      if (match[1] === 'key') key = unquote(match[2])
      if (match[1] === 'base_url') baseUrl = unquote(match[2])
    }

    return key ? { key, baseUrl } : null
  } catch {
    return null
  }
}

const credentialPath = process.env.DEEPSEEK_CREDENTIALS_PATH ?? process.env.CREDENTIALS_PATH
const fileCredential = readDeepSeekCredential(credentialPath)
const environmentKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
const apiKey = environmentKey || fileCredential?.key || ''
const requestedModel = process.env.DEEPSEEK_MODEL
const defaultModel: QaModelId = requestedModel === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash'

const deepseek: DeepSeekRuntimeConfig = {
  apiKey,
  baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || fileCredential?.baseUrl || 'https://api.deepseek.com',
  defaultModel,
  credentialSource: environmentKey ? 'environment' : fileCredential ? 'credentials-file' : 'missing',
}

/** 服务运行配置：环境变量优先，缺省回退安全默认值。 */
export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  serviceName: 'llmwiki-api',
  version: '0.1.0',
  /** SQLite 数据库文件路径（资料导入与处理队列的持久化存储） */
  databasePath: process.env.DATABASE_PATH ?? './data/llmwiki.db',
  /** 上传原件与解析产物的持久化目录。 */
  documentStoragePath:
    process.env.DOCUMENT_STORAGE_PATH ?? './data/documents',
  /** 保留真实阶段的可感知展示时间，不改变处理结果。 */
  documentStageDelayMs: Number(process.env.DOCUMENT_STAGE_DELAY_MS ?? 420),
  /** DeepSeek 凭证只保留在 API 进程内，前端只能读取脱敏状态。 */
  deepseek,
}
