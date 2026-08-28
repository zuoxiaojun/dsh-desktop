/** Browser launcher for the standalone FF - LLM Wiki application. */

import { useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Plugin.module.css'

const NS = 'ffLlmWiki'
const OPEN_PATH = '/api/ff-llm-wiki/open'
const SIDEBAR_VISIBILITY_KEY = 'ff-llm-wiki:sidebar-visible'
const SIDEBAR_VISIBILITY_EVENT = 'ff-llm-wiki:sidebar-visibility'

type WikiLocaleKey = 'nav' | 'openFailed' | 'openHint'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    ffLlmWiki: WikiLocaleKey
  }
}

type NavProps = PropsRuntime<'sidebar.primary.action'> & PropsLocale<'ffLlmWiki'>

function sidebarVisible(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_VISIBILITY_KEY) === 'true'
  } catch {
    return false
  }
}

function subscribeSidebarVisibility(onStoreChange: () => void): () => void {
  const synchronize = (): void => { onStoreChange() }
  window.addEventListener('storage', synchronize)
  window.addEventListener(SIDEBAR_VISIBILITY_EVENT, synchronize)
  return () => {
    window.removeEventListener('storage', synchronize)
    window.removeEventListener(SIDEBAR_VISIBILITY_EVENT, synchronize)
  }
}

function WikiMark() {
  return (
    <span className={css.mark} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id="ff-llm-wiki-sidebar-gradient" x1="8" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop stopColor="#51e7b2" />
            <stop offset="1" stopColor="#5d72ff" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="21" r="4" fill="url(#ff-llm-wiki-sidebar-gradient)" />
        <circle cx="43" cy="18" r="4" fill="url(#ff-llm-wiki-sidebar-gradient)" />
        <circle cx="45" cy="42" r="4" fill="url(#ff-llm-wiki-sidebar-gradient)" />
        <circle cx="21" cy="44" r="4" fill="url(#ff-llm-wiki-sidebar-gradient)" />
        <circle cx="32" cy="31" r="5" className={css.markFocus} />
        <path
          d="M23 23.5 28.5 28M39.5 21 35 27M36 35l6 4.5M28.5 35 24 41"
          fill="none"
          stroke="url(#ff-llm-wiki-sidebar-gradient)"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
    </span>
  )
}

function ExternalLaunchMark() {
  return (
    <svg className={css.launchMark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M9.5 3.5h3v3M12.25 3.75 7.5 8.5M7 4.5H4.75A1.25 1.25 0 0 0 3.5 5.75v5.5a1.25 1.25 0 0 0 1.25 1.25h5.5a1.25 1.25 0 0 0 1.25-1.25V9" />
    </svg>
  )
}

function WikiNav({ wide, t }: NavProps) {
  const visible = useSyncExternalStore(subscribeSidebarVisibility, sidebarVisible, () => true)
  const open = () => {
    const url = new URL(OPEN_PATH, window.location.href).toString()
    const opened = window.open(url, '_blank')
    if (opened !== null) opened.opener = null
  }

  if (!visible) return null

  return (
    <button
      type="button"
      className={`${css.entry}${wide ? '' : ` ${css.rail}`}`}
      aria-label={`${t('nav')}，${t('openHint')}`}
      title={wide ? undefined : `${t('nav')} · ${t('openHint')}`}
      data-ff-llm-wiki-nav="true"
      onClick={open}
    >
      <WikiMark />
      {wide ? <span className={css.label}>{t('nav')}</span> : null}
      {wide ? <ExternalLaunchMark /> : null}
    </button>
  )
}

export const inject = ['slots', 'locale']

/** Register one launcher without replacing any DSH main-page surface. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, {
    zh: { nav: 'FF - LLM Wiki', openFailed: '无法启动 FF - LLM Wiki', openHint: '在新窗口打开' },
    en: { nav: 'FF - LLM Wiki', openFailed: 'Unable to launch FF - LLM Wiki', openHint: 'Open in a new window' },
  }), 'ff-llm-wiki: dictionaries')
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'ff-llm-wiki',
    order: 35,
    locale: NS,
  }, WikiNav))
}
