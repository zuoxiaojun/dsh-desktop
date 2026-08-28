'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  QaAnswer,
  QaCitation,
  QaConnectionTestResponse,
  QaFallbackItem,
  QaModelConfigResponse,
  QaModelId,
  QaResponse,
} from '@llmwiki/contracts'
import { getQaModelConfig, streamQa, testQaModelConnection } from '../lib/qa'
import {
  DEFAULT_MODEL_PREFERENCES,
  loadModelPreferences,
  MODEL_PREFS_EVENT,
  MODEL_PREFS_KEY,
  type ModelPreferences,
} from '../lib/model-settings'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  DocumentIcon,
  LayersIcon,
  QaIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
  WikiIcon,
} from './Icons'

const SUGGESTIONS = [
  {
    category: '平台治理',
    title: '网关是如何做统一鉴权和限流的？',
    description: '定位接口安全、访问控制与流量治理规范',
    icon: '⌘',
  },
  {
    category: '变更管理',
    title: '生产环境变更要走什么流程？',
    description: '梳理申请、审批、发布与回滚的完整链路',
    icon: '↗',
  },
  {
    category: '安全响应',
    title: '数据泄露后应该怎么应急？',
    description: '核查事件分级、响应角色和处置时限',
    icon: '◇',
  },
  {
    category: '服务标准',
    title: 'SLA 的首次响应时限是怎么定义的？',
    description: '从服务制度中提取可执行的时效口径',
    icon: '◷',
  },
]

const HISTORY_KEY = 'llmwiki-ask-history'

type QaState = 'empty' | 'loading' | 'streaming' | 'answered' | 'no_evidence' | 'error'
type Feedback = 'up' | 'down'

interface Turn {
  id: number
  question: string
  state: QaState
  answers: QaAnswer[]
  citations: QaCitation[]
  fallback: QaFallbackItem[]
  metrics: QaResponse['metrics'] | null
  compiledAt: string | null
  confidence: QaResponse['confidence'] | null
  mode: QaResponse['mode']
  model: QaModelId | null
  providerConfigured: boolean
  generation: QaResponse['generation'] | null
  error: string | null
}

function MarkdownAnswer({
  text,
  onCite,
  litId,
}: {
  text: string
  onCite: (id: number) => void
  litId: number | null
}) {
  const markdown = text.replace(/\[(\d+)\](?!\()/g, '[$1](#cite-$1)')

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => {
          if (href?.startsWith('#cite-')) {
            const id = Number(href.slice(6))
            return (
              <button
                type="button"
                onClick={() => onCite(id)}
                className={`qa-cite ${litId === id ? 'qa-cite-lit' : ''}`}
                aria-label={`定位引用 ${id}`}
              >
                {id}
              </button>
            )
          }
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          )
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}

function sourceLabel(citation: QaCitation) {
  if (!citation.sourcePath) return citation.origin === 'conclusion' ? '知识页结论' : '原文证据'
  return citation.sourcePath.split('/').pop() ?? citation.sourcePath
}

function scoreLabel(score: number) {
  if (score <= 1) return `${Math.round(score * 100)}%`
  return score.toFixed(1)
}

function formatTime(value: string | null) {
  if (!value) return '当前编译版本'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '当前编译版本'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function QaView() {
  const router = useRouter()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [activeTurnId, setActiveTurnId] = useState<number | null>(null)
  const [litCitationId, setLitCitationId] = useState<number | null>(null)
  const [expandedCitationId, setExpandedCitationId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<Record<number, Feedback>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [modelConfig, setModelConfig] = useState<QaModelConfigResponse | null>(null)
  const [modelConfigError, setModelConfigError] = useState<string | null>(null)
  const [modelPreferences, setModelPreferences] = useState<ModelPreferences>(DEFAULT_MODEL_PREFERENCES)
  const [connectionTest, setConnectionTest] = useState<QaConnectionTestResponse | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setHistory(JSON.parse(saved) as string[])
      setModelPreferences(loadModelPreferences())
    } catch {
      /* 浏览器禁用存储时仍可正常问答 */
    }

    void getQaModelConfig()
      .then((remoteConfig) => {
        setModelConfig(remoteConfig)
        setModelConfigError(null)
        if (!localStorage.getItem(MODEL_PREFS_KEY)) {
          setModelPreferences(previous => ({ ...previous, model: remoteConfig.defaultModel }))
        }
      })
      .catch((error: unknown) => {
        setModelConfigError(error instanceof Error ? error.message : '无法读取模型配置')
      })
  }, [])

  useEffect(() => {
    const syncPreferences = (event: Event) => {
      const preferences = (event as CustomEvent<ModelPreferences>).detail
      setModelPreferences(preferences ?? loadModelPreferences())
    }
    window.addEventListener(MODEL_PREFS_EVENT, syncPreferences)
    return () => window.removeEventListener(MODEL_PREFS_EVENT, syncPreferences)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_PREFS_KEY, JSON.stringify(modelPreferences))
    } catch {
      /* ignore */
    }
  }, [modelPreferences])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const pushHistory = useCallback((question: string) => {
    setHistory((previous) => {
      const next = [question, ...previous.filter(item => item !== question)].slice(0, 20)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* 浏览器禁用存储时仅保留当前会话 */
      }
      return next
    })
  }, [])

  const removeHistory = useCallback((question: string) => {
    setHistory((previous) => {
      const next = previous.filter(item => item !== question)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    const element = threadRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [turns])

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim()
      if (!question) return
      pushHistory(question)
      setInput('')
      setLitCitationId(null)
      setExpandedCitationId(null)

      const id = ++seqRef.current
      setActiveTurnId(id)
      setTurns(previous => [
        ...previous,
        {
          id,
          question,
          state: 'loading',
          answers: [],
          citations: [],
          fallback: [],
          metrics: null,
          compiledAt: null,
          confidence: null,
          mode: modelPreferences.generationMode === 'deepseek' ? 'deepseek-rag' : 'local-weighted-retrieval',
          model: modelPreferences.generationMode === 'deepseek' ? modelPreferences.model : null,
          providerConfigured: modelConfig?.configured ?? false,
          generation: null,
          error: null,
        },
      ])

      const patchTurn = (patch: Partial<Turn>) => {
        setTurns(previous =>
          previous.map(turn => (turn.id === id ? { ...turn, ...patch } : turn)),
        )
      }

      await streamQa(
        question,
        modelPreferences,
        (chunk) => {
          switch (chunk.type) {
            case 'meta':
              patchTurn({
                state: 'streaming',
                metrics: chunk.metrics,
                compiledAt: chunk.compiledAt,
                confidence: chunk.confidence as QaResponse['confidence'],
                mode: chunk.mode,
                model: chunk.model as QaModelId,
                providerConfigured: chunk.providerConfigured,
              })
              break
            case 'generation':
              patchTurn({ generation: chunk.generation ?? null, mode: chunk.mode })
              break
            case 'delta':
              setTurns(current =>
                current.map((turn) => {
                  if (turn.id !== id) return turn
                  const currentText = turn.answers[0]?.text ?? ''
                  return {
                    ...turn,
                    state: 'streaming',
                    answers: [{ text: currentText + chunk.text, citations: [] }],
                  }
                }),
              )
              break
            case 'answer_complete':
              patchTurn({ answers: chunk.answers })
              break
            case 'answer':
              setTurns(current =>
                current.map(turn =>
                  turn.id === id ? { ...turn, answers: [...turn.answers, chunk.answer] } : turn,
                ),
              )
              break
            case 'citations':
              patchTurn({ citations: chunk.citations, state: 'answered' })
              setExpandedCitationId(chunk.citations[0]?.id ?? null)
              break
            case 'fallback':
              patchTurn({ fallback: chunk.fallback })
              break
          }
        },
        () => {
          setTurns(current =>
            current.map((turn) => {
              if (turn.id !== id) return turn
              return {
                ...turn,
                state: turn.answers.length > 0 ? 'answered' : 'no_evidence',
              }
            }),
          )
        },
        message => patchTurn({ state: 'error', error: message }),
      )
    },
    [modelConfig?.configured, modelPreferences, pushHistory],
  )

  const openWiki = useCallback(
    (slug: string) => router.push(`/wiki?slug=${encodeURIComponent(slug)}`),
    [router],
  )

  const activeTurn = useMemo(
    () => turns.find(turn => turn.id === activeTurnId) ?? turns.at(-1) ?? null,
    [activeTurnId, turns],
  )
  const isBusy = turns.some(turn => turn.state === 'loading' || turn.state === 'streaming')

  const focusCitation = useCallback((turnId: number, citationId: number) => {
    setActiveTurnId(turnId)
    setExpandedCitationId(citationId)
    setLitCitationId(citationId)
    window.setTimeout(() => {
      document
        .getElementById(`qa-source-${turnId}-${citationId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 40)
    window.setTimeout(() => setLitCitationId(null), 2400)
  }, [])

  const copyAnswer = useCallback(async (turn: Turn) => {
    try {
      await navigator.clipboard.writeText(turn.answers.map(answer => answer.text).join('\n\n'))
      setNotice('回答已复制')
    } catch {
      setNotice('复制失败，请重试')
    }
  }, [])

  const vote = useCallback((turnId: number, value: Feedback) => {
    setFeedback((previous) => {
      const next = { ...previous }
      if (previous[turnId] === value) delete next[turnId]
      else next[turnId] = value
      return next
    })
    setNotice(value === 'up' ? '已记录：回答有帮助' : '已记录：需要改进')
  }, [])

  const startNew = useCallback(() => {
    setTurns([])
    setActiveTurnId(null)
    setLitCitationId(null)
    setExpandedCitationId(null)
    setInput('')
  }, [])

  const runConnectionTest = useCallback(async () => {
    setTestingConnection(true)
    setConnectionTest(null)
    try {
      const result = await testQaModelConnection(modelPreferences.model)
      setConnectionTest(result)
    } catch (error) {
      setConnectionTest({
        ok: false,
        provider: 'deepseek',
        model: modelPreferences.model,
        latencyMs: 0,
        message: error instanceof Error ? error.message : '连接测试失败',
      })
    } finally {
      setTestingConnection(false)
    }
  }, [modelPreferences.model])

  return (
    <div className="qa-scope relative overflow-hidden rounded-[22px] p-3 sm:p-4">
      {notice && (
        <div className="qa-toast" role="status">
          <CheckCircleIcon className="h-4 w-4" />
          {notice}
        </div>
      )}

      {modelPanelOpen && (
        <div className="qa-model-overlay" role="presentation" onMouseDown={() => setModelPanelOpen(false)}>
          <section
            className="qa-model-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qa-model-panel-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="qa-model-logo">DS</span>
                <div>
                  <h2 id="qa-model-panel-title">模型连接与生成配置</h2>
                  <p>密钥由后端凭证中心托管，浏览器不会接触明文 Key</p>
                </div>
              </div>
              <button type="button" onClick={() => setModelPanelOpen(false)} aria-label="关闭模型配置">×</button>
            </header>

            <div className="qa-provider-card">
              <div className="qa-provider-identity">
                <span className="qa-model-logo compact">DS</span>
                <div><strong>DeepSeek API</strong><small>{modelConfig?.endpoint ?? '读取配置中…'}</small></div>
              </div>
              <span className={`qa-provider-state ${modelConfig?.configured ? 'is-online' : ''}`}>
                <i />{modelConfig?.configured ? '凭证已加载' : '等待凭证'}
              </span>
              <div className="qa-credential-row">
                <span>API Key</span><code>{modelConfig?.credentialLabel ?? '检测中'}</code>
                <em>{modelConfig?.credentialSource === 'credentials-file' ? '凭证中心' : modelConfig?.credentialSource === 'environment' ? '环境变量' : '未配置'}</em>
              </div>
              <div className="qa-store-row">
                <span><i />知识数据层</span>
                <strong>{modelConfig?.knowledgeStore.engine ?? 'SQLite'}</strong>
                <em>{modelConfig ? `${modelConfig.knowledgeStore.pages} 页 · ${modelConfig.knowledgeStore.chunks} 个证据片段` : '正在同步知识数据'}</em>
                <b>{modelConfig?.knowledgeStore.persistent ? '持久化' : '内存模式'}</b>
              </div>
            </div>

            <div className="qa-model-form">
              <label>
                <span>回答模式<small>决定是否调用模型</small></span>
                <div className="qa-segmented-control">
                  <button
                    type="button"
                    className={modelPreferences.generationMode === 'deepseek' ? 'is-active' : ''}
                    onClick={() => setModelPreferences(previous => ({ ...previous, generationMode: 'deepseek' }))}
                  >DeepSeek RAG</button>
                  <button
                    type="button"
                    className={modelPreferences.generationMode === 'local' ? 'is-active' : ''}
                    onClick={() => setModelPreferences(previous => ({ ...previous, generationMode: 'local' }))}
                  >本地检索</button>
                </div>
              </label>

              <label>
                <span>模型<small>按问题复杂度选择</small></span>
                <select
                  value={modelPreferences.model}
                  onChange={event => setModelPreferences(previous => ({ ...previous, model: event.target.value as QaModelId }))}
                  disabled={modelPreferences.generationMode === 'local'}
                >
                  {(modelConfig?.models ?? [
                    { id: 'deepseek-v4-flash' as const, label: 'DeepSeek V4 Flash', description: '' },
                    { id: 'deepseek-v4-pro' as const, label: 'DeepSeek V4 Pro', description: '' },
                  ]).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>

              <label>
                <span>生成温度<small>越低越稳定、越适合知识问答</small></span>
                <div className="qa-temperature-control">
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.1"
                    value={modelPreferences.temperature}
                    disabled={modelPreferences.generationMode === 'local'}
                    onChange={event => setModelPreferences(previous => ({ ...previous, temperature: Number(event.target.value) }))}
                  />
                  <code>{modelPreferences.temperature.toFixed(1)}</code>
                </div>
              </label>

              <label>
                <span>最大输出<small>控制单次回答的内容长度</small></span>
                <div className="qa-temperature-control">
                  <input
                    type="range"
                    min="256"
                    max="4096"
                    step="128"
                    value={modelPreferences.maxTokens}
                    disabled={modelPreferences.generationMode === 'local'}
                    onChange={event => setModelPreferences(previous => ({ ...previous, maxTokens: Number(event.target.value) }))}
                  />
                  <code>{modelPreferences.maxTokens}</code>
                </div>
              </label>
            </div>

            {modelConfigError && <div className="qa-config-message is-error">{modelConfigError}</div>}
            {connectionTest && (
              <div className={`qa-config-message ${connectionTest.ok ? 'is-ok' : 'is-error'}`}>
                <span>{connectionTest.ok ? '✓' : '!'}</span>
                <div><strong>{connectionTest.message}</strong><small>{connectionTest.latencyMs > 0 ? `${connectionTest.latencyMs} ms` : '请检查后端配置'}</small></div>
              </div>
            )}

            <footer>
              <p><i />模型只能读取本次检索命中的证据片段</p>
              <div>
                <button type="button" className="qa-test-button" onClick={runConnectionTest} disabled={testingConnection}>
                  {testingConnection ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : '测试连接'}
                </button>
                <button type="button" className="qa-save-button" onClick={() => setModelPanelOpen(false)}>应用配置</button>
              </div>
            </footer>
          </section>
        </div>
      )}

      <header className="qa-workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="qa-brand-mark">
            <QaIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="qa-ink text-lg font-semibold tracking-tight">知识问答工作台</h1>
              <span className="qa-status-dot"><i />检索服务在线</span>
            </div>
            <p className="qa-faint mt-0.5 truncate text-[13px]">基于企业知识库回答，结论与原文证据双向定位</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="qa-stat-pill"><strong>47</strong> 知识页</span>
          <span className="qa-stat-pill"><strong>98</strong> 原文引用</span>
          <span className="qa-stat-pill"><strong>3,210</strong> 关系</span>
          <button type="button" onClick={() => setModelPanelOpen(true)} className="qa-model-trigger">
            <span className="qa-model-trigger-mark">DS</span>
            <span><strong>{modelPreferences.generationMode === 'deepseek' ? modelPreferences.model : '本地检索'}</strong><small>{modelConfig?.configured ? 'DeepSeek 已连接' : '检查模型配置'}</small></span>
            <em>⌄</em>
          </button>
          <button type="button" onClick={startNew} className="qa-primary-button">
            <span>＋</span> 新建对话
          </button>
        </div>
      </header>

      <div className="qa-workspace-grid">
        <aside className="qa-panel qa-history-panel">
          <div className="qa-section-heading">
            <div>
              <span className="qa-ink">最近对话</span>
              <small>{history.length} 条记录</small>
            </div>
          </div>

          <div className="qa-history-list">
            {history.length === 0 ? (
              <div className="qa-empty-compact">
                <QaIcon className="h-5 w-5" />
                <span>提问后将自动保存会话</span>
              </div>
            ) : (
              history.map((item, index) => (
                <div key={`${item}-${index}`} className="qa-history-item">
                  <button type="button" onClick={() => ask(item)} title={item}>
                    <span className="qa-history-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1">
                      <strong>{item}</strong>
                      <small>{index === 0 ? '刚刚访问' : '历史问题'}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistory(item)}
                    className="qa-history-remove"
                    aria-label={`移除历史问题：${item}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="qa-space-card">
            <div className="flex items-center gap-2">
              <WikiIcon className="h-4 w-4" />
              <span>当前知识空间</span>
            </div>
            <strong>工业知识库</strong>
            <div className="qa-space-metrics">
              <span><b>128</b> 文档</span>
              <span><b>6</b> 业务域</span>
            </div>
            <div className="qa-freshness"><i />知识索引已同步</div>
          </div>
        </aside>

        <main className="qa-panel qa-conversation-panel">
          <div className="qa-conversation-bar">
            <div>
              <span className="qa-ink text-[15px] font-semibold">
                {activeTurn ? '知识库助手' : '开始一次可溯源问答'}
              </span>
              <span className="qa-faint ml-2 text-[13px]">
                {activeTurn ? formatTime(activeTurn.compiledAt) : 'RAG · 检索增强生成'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="qa-mode-pill" onClick={() => setModelPanelOpen(true)}>
                <i />{activeTurn?.mode === 'deepseek-rag' ? activeTurn.model : activeTurn?.mode === 'local-fallback' ? '模型降级' : modelPreferences.generationMode === 'deepseek' ? modelPreferences.model : '本地检索'}
              </button>
              {activeTurn?.confidence && (
                <span className="qa-confidence-pill">{activeTurn.confidence === 'high' ? '高' : activeTurn.confidence === 'medium' ? '中' : '低'}置信</span>
              )}
            </div>
          </div>

          <div ref={threadRef} className="qa-thread" aria-live="polite">
            {turns.length === 0 && (
              <div className="qa-launcher">
                <div className="qa-launcher-title">
                  <span className="qa-launcher-orbit"><SearchIcon className="h-6 w-6" /></span>
                  <div>
                    <h2>想从知识库中了解什么？</h2>
                    <p>选择一个问题，查看系统如何检索、筛选并组织可信证据。</p>
                  </div>
                </div>

                <div className="qa-suggestion-grid">
                  {SUGGESTIONS.map(suggestion => (
                    <button
                      key={suggestion.title}
                      type="button"
                      onClick={() => ask(suggestion.title)}
                      className="qa-suggestion-card"
                    >
                      <span className="qa-suggestion-icon">{suggestion.icon}</span>
                      <span className="min-w-0 flex-1">
                        <small>{suggestion.category}</small>
                        <strong>{suggestion.title}</strong>
                        <em>{suggestion.description}</em>
                      </span>
                      <span className="qa-suggestion-arrow">→</span>
                    </button>
                  ))}
                </div>

                <div className="qa-capability-strip">
                  <span><SearchIcon className="h-4 w-4" /><b>加权检索</b><small>字段权重 + 片段召回</small></span>
                  <span><LayersIcon className="h-4 w-4" /><b>证据重排</b><small>按相关度筛选片段</small></span>
                  <span><DocumentIcon className="h-4 w-4" /><b>模型生成</b><small>DeepSeek 基于证据回答</small></span>
                </div>
              </div>
            )}

            {turns.map(turn => (
              <section key={turn.id} className="qa-turn" onClick={() => setActiveTurnId(turn.id)}>
                <div className="qa-user-row">
                  <div className="qa-user-message">{turn.question}</div>
                  <div className="qa-user-avatar">我</div>
                </div>

                <div className="qa-answer-row">
                  <div className="qa-assistant-avatar"><QaIcon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="qa-answer-meta">
                      <div>
                        <strong>知识库助手</strong>
                        <span>{turn.mode === 'deepseek-chat' ? '通用对话' : '基于已编译知识资产'}</span>
                      </div>
                      {(turn.generation || (turn.metrics && turn.mode !== 'deepseek-chat')) && (
                        <div className="flex items-center gap-2">
                          {turn.generation && (
                            <span className={`qa-generation-chip ${turn.mode === 'deepseek-rag' || turn.mode === 'deepseek-chat' ? 'is-model' : 'is-local'}`}>
                              {turn.mode === 'deepseek-rag' || turn.mode === 'deepseek-chat' ? `${turn.generation.model} · ${(turn.generation.latencyMs / 1000).toFixed(1)}s` : '本地降级'}
                            </span>
                          )}
                          {turn.metrics && turn.mode !== 'deepseek-chat' && (
                            <div className="qa-result-metrics">
                              <span>扫描 <b>{turn.metrics.searched}</b></span>
                              <span>命中 <b>{turn.metrics.matched}</b></span>
                              <span>采用 <b>{turn.metrics.adopted}</b></span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {turn.state === 'loading' && (
                      <div className="qa-searching-state">
                        <SpinnerIcon className="h-4 w-4 animate-spin" />
                        正在跨知识页检索相关片段…
                      </div>
                    )}

                    {turn.state === 'error' && (
                      <div className="qa-error-state">
                        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p>{turn.error ?? '问答请求失败'}</p>
                          <button type="button" onClick={() => ask(turn.question)}>重新检索</button>
                        </div>
                      </div>
                    )}

                    {turn.generation?.fallbackReason && turn.mode === 'local-fallback' && (
                      <div className="qa-model-fallback">
                        <AlertCircleIcon className="h-3.5 w-3.5" />
                        DeepSeek 未完成生成，已返回可追溯的本地检索结果：{turn.generation.fallbackReason}
                      </div>
                    )}

                    {(turn.state === 'streaming' || turn.state === 'answered') && turn.answers.length > 0 && (
                      <div className="qa-answer-body">
                        {turn.answers.map((answer, index) => (
                          <div key={index} className="qa-markdown">
                            <MarkdownAnswer
                              text={answer.text}
                              onCite={citationId => focusCitation(turn.id, citationId)}
                              litId={activeTurn?.id === turn.id ? litCitationId : null}
                            />
                            {!/\[\d+\]/.test(answer.text) && answer.citations.length > 0 && (
                              <span className="qa-answer-references">
                                {answer.citations.map(citationId => (
                                  <button
                                    key={citationId}
                                    type="button"
                                    onClick={() => focusCitation(turn.id, citationId)}
                                    className={`qa-cite ${activeTurn?.id === turn.id && litCitationId === citationId ? 'qa-cite-lit' : ''}`}
                                    aria-label={`定位引用 ${citationId}`}
                                  >
                                    {citationId}
                                  </button>
                                ))}
                              </span>
                            )}
                          </div>
                        ))}
                        {turn.state === 'streaming' && <span className="qa-stream-caret" />}
                      </div>
                    )}

                    {turn.state === 'no_evidence' && (
                      <div className="qa-no-evidence-state">
                        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <strong>当前证据不足，未生成确定性结论</strong>
                          <p>右侧仍列出最接近的知识页，建议调整问题范围后再次检索。</p>
                        </div>
                      </div>
                    )}

                    {turn.state === 'answered' && (
                      <div className="space-y-3">
                        <div className="qa-answer-actions">
                          <button type="button" onClick={() => copyAnswer(turn)}>复制回答</button>
                          <button type="button" onClick={() => ask(turn.question)}>
                            <RefreshIcon className="h-3.5 w-3.5" />重新检索
                          </button>
                          <span className="qa-action-divider" />
                          <span>这条回答有帮助吗？</span>
                          <button
                            type="button"
                            className={feedback[turn.id] === 'up' ? 'is-selected' : ''}
                            onClick={() => vote(turn.id, 'up')}
                            aria-label="回答有帮助"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={feedback[turn.id] === 'down' ? 'is-selected' : ''}
                            onClick={() => vote(turn.id, 'down')}
                            aria-label="回答需要改进"
                          >
                            ↓
                          </button>
                        </div>
                        <div className="qa-followups">
                          <span>继续追问</span>
                          <button type="button" onClick={() => ask(`${turn.question} 请整理成可执行的检查清单。`)}>整理执行清单</button>
                          <button type="button" onClick={() => ask(`${turn.question} 其中最容易遗漏的风险点有哪些？`)}>查看风险点</button>
                          <button type="button" onClick={() => ask(`${turn.question} 相关职责与时间要求分别是什么？`)}>核查职责时限</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>

          <div className="qa-composer-wrap">
            <div className="qa-composer">
              <SearchIcon className="qa-faint h-4 w-4 shrink-0" />
              <textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (!isBusy) void ask(input)
                  }
                }}
                rows={1}
                placeholder={isBusy ? '正在处理当前问题…' : '输入问题，Enter 发送，Shift + Enter 换行'}
                disabled={isBusy}
                aria-label="向知识库提问"
              />
              <div className="qa-composer-tools">
                <span>知识库</span>
                <button
                  type="button"
                  onClick={() => ask(input)}
                  disabled={!input.trim() || isBusy}
                  aria-label="发送问题"
                >
                  {isBusy ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : '↑'}
                </button>
              </div>
            </div>
            <p>回答仅使用可核查资料 · 点击引用编号可在右侧定位证据</p>
          </div>
        </main>

        <aside className="qa-panel qa-evidence-panel">
          <div className="qa-section-heading qa-evidence-heading">
            <div>
              <span className="qa-ink">证据工作区</span>
              <small>{activeTurn ? `问题 #${activeTurn.id}` : '等待检索'}</small>
            </div>
            <span className="qa-evidence-count">{activeTurn?.citations.length ?? 0} 条采用</span>
          </div>

          <div className="qa-evidence-summary">
            <div><span>检索范围</span><strong>{activeTurn?.metrics?.searched ?? 47} 页</strong></div>
            <div><span>命中片段</span><strong>{activeTurn?.metrics?.matched ?? 0} 条</strong></div>
            <div><span>采用证据</span><strong>{activeTurn?.metrics?.adopted ?? 0} 条</strong></div>
          </div>

          <div className="qa-evidence-list">
            {!activeTurn && (
              <div className="qa-evidence-empty">
                <span className="qa-evidence-radar"><i /><i /><i /><SearchIcon className="h-5 w-5" /></span>
                <strong>等待一次知识检索</strong>
                <p>提问后，系统采用的原文证据会按相关度排列在这里。</p>
                <div>
                  <span>引用定位</span><span>置信分级</span><span>原文回跳</span>
                </div>
              </div>
            )}

            {activeTurn?.citations.map((citation) => {
              const expanded = expandedCitationId === citation.id
              const highlighted = litCitationId === citation.id
              return (
                <article
                  id={`qa-source-${activeTurn.id}-${citation.id}`}
                  key={`${activeTurn.id}-${citation.id}`}
                  className={`qa-source-card ${highlighted ? 'is-highlighted' : ''} ${expanded ? 'is-expanded' : ''}`}
                >
                  <button
                    type="button"
                    className="qa-source-card-main"
                    onClick={() => {
                      setExpandedCitationId(expanded ? null : citation.id)
                      setLitCitationId(citation.id)
                    }}
                    aria-expanded={expanded}
                  >
                    <span className="qa-source-number">{citation.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="qa-source-kicker">
                        <b>{citation.origin === 'evidence' ? '原文证据' : '知识页结论'}</b>
                        <em>{citation.confidence === 'high' ? '高置信' : citation.confidence === 'medium' ? '中置信' : '低置信'}</em>
                      </span>
                      <strong className="qa-source-title">{citation.pageTitle}</strong>
                      <small>{sourceLabel(citation)}</small>
                    </span>
                    <span className="qa-source-score">{scoreLabel(citation.score)}</span>
                  </button>
                  <div className="qa-source-snippet">
                    <p>{citation.snippet}</p>
                    <div>
                      <span>{citation.pageType}</span>
                      <button type="button" onClick={() => openWiki(citation.pageSlug)}>查看 Wiki 原文 →</button>
                    </div>
                  </div>
                </article>
              )
            })}

            {activeTurn?.state === 'no_evidence' && activeTurn.fallback.map((item, index) => (
              <button
                key={`${item.pageSlug}-${index}`}
                type="button"
                onClick={() => openWiki(item.pageSlug)}
                className="qa-fallback-card"
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{item.pageTitle}</strong><small>{item.summary}</small></span>
                <em>→</em>
              </button>
            ))}
          </div>

          <div className="qa-evidence-footer">
            <span><i />证据来自当前编译知识库</span>
            <small>
              {activeTurn?.generation?.provider === 'deepseek'
                ? `${activeTurn.generation.totalTokens ?? '—'} tokens · ${activeTurn.generation.latencyMs} ms`
                : formatTime(activeTurn?.compiledAt ?? null)}
            </small>
          </div>
        </aside>
      </div>
    </div>
  )
}
