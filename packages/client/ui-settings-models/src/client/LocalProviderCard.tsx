/** Guided setup for local OpenAI-compatible model servers. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import type { CustomProviderInitialValues } from './CustomProviderCard.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** OpenAI-compatible protocol shared by the local server presets. */
export const LOCAL_PROVIDER_PROTOCOL = 'openai-completions'

/** One first-party local inference preset. */
export interface LocalProviderPreset extends CustomProviderInitialValues {
  /** Stable selector identity. */
  id: string
}

/** Local inference presets in the order shown to users. */
const DEFAULT_LOCAL_PROVIDER: LocalProviderPreset = {
  id: 'ollama',
  route: 'ollama',
  displayName: 'Ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  protocol: LOCAL_PROVIDER_PROTOCOL,
  allowUnauthenticated: true,
}

/** Local inference presets in the order shown to users. */
export const LOCAL_PROVIDER_PRESETS: readonly LocalProviderPreset[] = [
  DEFAULT_LOCAL_PROVIDER,
  {
    id: 'vllm',
    route: 'vllm',
    displayName: 'vLLM',
    baseURL: 'http://127.0.0.1:8000/v1',
    protocol: LOCAL_PROVIDER_PROTOCOL,
    allowUnauthenticated: true,
  },
  {
    id: 'sglang',
    route: 'sglang',
    displayName: 'SGLang',
    baseURL: 'http://127.0.0.1:30000/v1',
    protocol: LOCAL_PROVIDER_PROTOCOL,
    allowUnauthenticated: true,
  },
  {
    id: 'openai-compatible',
    route: 'local-openai',
    displayName: 'OpenAI-compatible',
    baseURL: 'http://127.0.0.1:8000/v1',
    protocol: LOCAL_PROVIDER_PROTOCOL,
    allowUnauthenticated: true,
  },
]

/** Props of {@link LocalProviderCard}. */
export interface LocalProviderCardProps {
  /** Existing provider route ids. */
  taken: readonly string[]
  /** Protocols accepted by the pi-ai namespace. */
  protocols: readonly string[]
  /** Revision captured for the provider create. */
  revision: number
  /** Wire faces used by the shared creation form. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes. */
  readOnly: boolean
  /** Close the card; `changed` reports whether a route was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render framework selection and the shared provider creation form.
 * @param props - current routes, wire faces, and localized copy.
 * @returns the guided local-model card.
 */
export function LocalProviderCard(props: LocalProviderCardProps): ReactNode {
  const available = LOCAL_PROVIDER_PRESETS.filter(preset => !props.taken.includes(preset.route))
  const [selectedId, setSelectedId] = useState(available[0]?.id ?? DEFAULT_LOCAL_PROVIDER.id)
  const selected = LOCAL_PROVIDER_PRESETS.find(preset => preset.id === selectedId) ?? DEFAULT_LOCAL_PROVIDER

  return (
    <div className={styles['localSetup']}>
      <div className={styles['localHeader']}>
        <span className={styles['editorTitle']}>{props.t('localTitle')}</span>
        <p className={styles['advancedHint']}>{props.t('localDescription')}</p>
      </div>
      <div
        className={styles['localPresetGrid']}
        role="radiogroup"
        aria-label={props.t('localFramework')}
      >
        {LOCAL_PROVIDER_PRESETS.map((preset) => {
          const installed = props.taken.includes(preset.route)
          const active = preset.id === selected.id
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={installed || props.readOnly}
              className={`${styles['localPresetButton']}${active ? ` ${styles['localPresetButtonActive']}` : ''}`}
              onClick={() => { setSelectedId(preset.id) }}
            >
              <span className={styles['localPresetName']}>{preset.displayName}</span>
              <span className={styles['localPresetEndpoint']}>
                {installed ? props.t('localConfigured') : preset.baseURL}
              </span>
            </button>
          )
        })}
      </div>
      <CustomProviderCard
        key={selected.id}
        taken={props.taken}
        protocols={props.protocols}
        revision={props.revision}
        api={props.api}
        t={props.t}
        readOnly={props.readOnly}
        initial={selected}
        variant="local"
        onClose={props.onClose}
      />
    </div>
  )
}
