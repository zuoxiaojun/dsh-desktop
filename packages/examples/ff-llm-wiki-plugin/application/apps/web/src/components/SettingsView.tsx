'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { QaConnectionTestResponse, QaModelConfigResponse } from '@llmwiki/contracts'
import { getQaModelConfig, testQaModelConnection } from '../lib/qa'
import {
  DEFAULT_MODEL_PREFERENCES,
  loadModelPreferences,
  saveModelPreferences,
  type ModelPreferences,
} from '../lib/model-settings'
import {
  CheckCircleIcon,
  LayersIcon,
  QaIcon,
  SettingsIcon,
  SpinnerIcon,
} from './Icons'

const FALLBACK_MODELS: QaModelConfigResponse['models'] = [
  {
    id: 'deepseek-v4-flash',
    label: 'V4 Flash',
    description: '低延迟、高吞吐，适合日常知识问答与内容归纳',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'V4 Pro',
    description: '更强推理能力，适合复杂制度分析与多步骤判断',
  },
]

function sourceLabel(source: QaModelConfigResponse['credentialSource'] | undefined) {
  if (source === 'credentials-file') return '凭证文件'
  if (source === 'environment') return '环境变量'
  return '尚未配置'
}

export function SettingsView() {
  const [config, setConfig] = useState<QaModelConfigResponse | null>(null)
  const [preferences, setPreferences] = useState<ModelPreferences>(DEFAULT_MODEL_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<QaConnectionTestResponse | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const localPreferences = loadModelPreferences()
    setPreferences(localPreferences)

    void getQaModelConfig()
      .then((remoteConfig) => {
        setConfig(remoteConfig)
        setError(null)
        if (!localStorage.getItem('llmwiki-qa-model-preferences')) {
          setPreferences(current => ({ ...current, model: remoteConfig.defaultModel }))
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '无法读取模型服务配置')
      })
      .finally(() => setLoading(false))
  }, [])

  const models = config?.models ?? FALLBACK_MODELS
  const selectedModel = useMemo(
    () => models.find(model => model.id === preferences.model) ?? models[0],
    [models, preferences.model],
  )

  const update = <Key extends keyof ModelPreferences>(
    key: Key,
    value: ModelPreferences[Key],
  ) => {
    setSaved(false)
    setTestResult(null)
    setPreferences(current => ({ ...current, [key]: value }))
  }

  const save = () => {
    try {
      setPreferences(saveModelPreferences(preferences))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch {
      setError('浏览器无法保存设置，请检查本地存储权限')
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const normalized = saveModelPreferences(preferences)
      setPreferences(normalized)
      setTestResult(await testQaModelConnection(normalized.model))
    } catch (cause) {
      setTestResult({
        ok: false,
        provider: 'deepseek',
        model: preferences.model,
        latencyMs: 0,
        message: cause instanceof Error ? cause.message : '模型验证失败',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-scope">
      <header className="settings-heading">
        <div className="settings-title-row">
          <span className="settings-title-icon"><SettingsIcon /></span>
          <div>
            <h1>系统设置</h1>
            <p>统一管理 Agent 智能问答使用的模型服务与生成参数</p>
          </div>
        </div>
        <Link href="/ask" className="settings-ask-link">
          <QaIcon />进入智能问答<span>→</span>
        </Link>
      </header>

      <section className="settings-provider-card">
        <div className="settings-provider-main">
          <span className="settings-provider-mark">DS</span>
          <div>
            <div className="settings-provider-title">
              <h2>DeepSeek 模型服务</h2>
              <span className={config?.configured ? 'is-online' : ''}>
                <i />{loading ? '正在检测' : config?.configured ? '服务已就绪' : '等待凭证'}
              </span>
            </div>
            <p>{config?.endpoint ?? '正在读取服务地址…'}</p>
          </div>
        </div>
        <div className="settings-provider-facts">
          <div><small>凭证状态</small><strong>{config?.credentialLabel ?? '检测中'}</strong><em>{sourceLabel(config?.credentialSource)}</em></div>
          <div><small>当前模型</small><strong>{selectedModel?.label ?? '通用对话'}</strong><em>{preferences.model}</em></div>
          <div><small>知识数据</small><strong>{config?.knowledgeStore.engine ?? 'SQLite'}</strong><em>{config ? `${config.knowledgeStore.pages} 页 · ${config.knowledgeStore.chunks} 个片段` : '正在同步'}</em></div>
        </div>
      </section>

      <main className="settings-grid">
        <section className="settings-panel settings-model-panel">
          <div className="settings-section-head">
            <div><span>01</span><h2>选择模型</h2></div>
            <small>选择后将应用到 Agent 智能问答</small>
          </div>

          <div className="settings-model-list">
            {models.map((model, index) => {
              const active = preferences.model === model.id
              return (
                <button
                  key={model.id}
                  type="button"
                  className={active ? 'is-active' : ''}
                  onClick={() => update('model', model.id)}
                >
                  <span className="settings-model-index">0{index + 1}</span>
                  <span className="settings-model-copy">
                    <strong>{model.label}</strong>
                    <code>{model.id}</code>
                    <small>{model.description}</small>
                  </span>
                  <span className="settings-model-radio">{active ? '✓' : ''}</span>
                </button>
              )
            })}
          </div>

          <div className="settings-mode-row">
            <div><strong>回答模式</strong><small>模型不可用时仍可退回本地检索</small></div>
            <div className="settings-switcher">
              <button
                type="button"
                className={preferences.generationMode === 'deepseek' ? 'is-active' : ''}
                onClick={() => update('generationMode', 'deepseek')}
              >模型增强</button>
              <button
                type="button"
                className={preferences.generationMode === 'local' ? 'is-active' : ''}
                onClick={() => update('generationMode', 'local')}
              >仅本地检索</button>
            </div>
          </div>
        </section>

        <section className="settings-panel settings-parameters-panel">
          <div className="settings-section-head">
            <div><span>02</span><h2>生成参数</h2></div>
            <small>参数会随每次问答请求发送</small>
          </div>

          <label>
            <div><strong>生成温度</strong><small>数值越低，回答越稳定</small></div>
            <div className="settings-range-row">
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.1"
                value={preferences.temperature}
                onChange={event => update('temperature', Number(event.target.value))}
              />
              <output>{preferences.temperature.toFixed(1)}</output>
            </div>
          </label>

          <label>
            <div><strong>最大输出长度</strong><small>控制单次回答最多生成的内容</small></div>
            <div className="settings-range-row">
              <input
                type="range"
                min="256"
                max="4096"
                step="128"
                value={preferences.maxTokens}
                onChange={event => update('maxTokens', Number(event.target.value))}
              />
              <output>{preferences.maxTokens}</output>
            </div>
          </label>

          <div className="settings-security-note">
            <span>⌾</span>
            <div><strong>密钥由服务端安全托管</strong><small>浏览器只读取脱敏状态，任何请求和页面都不会返回明文密钥。</small></div>
          </div>
        </section>
      </main>

      <section className="settings-verification">
        <div className="settings-verification-copy">
          <span className="settings-verify-icon"><LayersIcon /></span>
          <div>
            <h2>模型可用性验证</h2>
            <p>测试会使用当前所选模型发起一次最小真实推理，而不是只检查地址或密钥格式。</p>
          </div>
        </div>

        <div className="settings-checks" aria-label="模型验证链路">
          <span className={config ? 'is-done' : ''}><i>1</i>读取配置</span>
          <b />
          <span className={config?.configured ? 'is-done' : ''}><i>2</i>加载凭证</span>
          <b />
          <span className={testResult?.ok ? 'is-done' : testing ? 'is-running' : ''}><i>3</i>调用模型</span>
          <b />
          <span className={testResult?.ok ? 'is-done' : ''}><i>4</i>返回结果</span>
        </div>

        {(error || testResult) && (
          <div className={`settings-result ${testResult?.ok ? 'is-ok' : 'is-error'}`} role="status">
            {testResult?.ok ? <CheckCircleIcon /> : <span>!</span>}
            <div>
              <strong>{testResult?.message ?? error}</strong>
              <small>{testResult ? `${testResult.model} · ${testResult.latencyMs} ms · 真实推理验证` : '请检查 API 服务是否启动'}</small>
            </div>
          </div>
        )}

        <div className="settings-actions">
          <span>{saved ? '✓ 配置已保存并同步到智能问答' : '所有参数仅保存于当前浏览器，密钥仍由服务端托管'}</span>
          <div>
            <button type="button" className="settings-save-button" onClick={save}>保存配置</button>
            <button type="button" className="settings-test-button" onClick={testConnection} disabled={testing || !config?.configured}>
              {testing ? <><SpinnerIcon />正在调用模型</> : '验证当前模型'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
