import { useCallback, useEffect, useState } from 'react'
import {
  Button, IconDataOutline16, IconRefreshOutline16, IconRightUpOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ApplicationCenterPage.module.css'

/** Runtime evidence returned by one built-in application. */
export interface ApplicationRuntimeStatus {
  readonly available: boolean
  readonly credentialConfigured: boolean
}

/** Operations provided to the independent Application Center page. */
export interface ApplicationCenterInjected {
  readonly inspectLlmWiki: () => Promise<ApplicationRuntimeStatus>
  readonly openLlmWiki: () => void
  readonly openModelSettings: () => void
  readonly getLlmWikiSidebarVisible: () => boolean
  readonly setLlmWikiSidebarVisible: (visible: boolean) => void
}

/** Full props assembled by the independent main-page renderer. */
export type ApplicationCenterPageProps =
  PropsRuntime<'main.page'>
  & PropsLocale<'pluginCenter'>
  & InjectFace<ApplicationCenterInjected>

type RuntimeState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: ApplicationRuntimeStatus }

function WikiArtwork() {
  return (
    <span className={css.artwork} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="presentation">
        <defs>
          <linearGradient id="application-wiki-gradient" x1="8" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop stopColor="#51e7b2" />
            <stop offset="1" stopColor="#5d72ff" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="56" height="56" rx="17" fill="#071b1b" />
        <circle cx="20" cy="21" r="4" fill="url(#application-wiki-gradient)" />
        <circle cx="43" cy="18" r="4" fill="url(#application-wiki-gradient)" />
        <circle cx="45" cy="42" r="4" fill="url(#application-wiki-gradient)" />
        <circle cx="21" cy="44" r="4" fill="url(#application-wiki-gradient)" />
        <circle cx="32" cy="31" r="5" fill="#ecfffa" />
        <path d="M23 23.5 28.5 28M39.5 21 35 27M36 35l6 4.5M28.5 35 24 41" stroke="url(#application-wiki-gradient)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/** Application catalog for complete products shipped by the Fufan Desktop team. */
export function ApplicationCenterPage({
  inspectLlmWiki,
  openLlmWiki,
  openModelSettings,
  getLlmWikiSidebarVisible,
  setLlmWikiSidebarVisible,
  t,
}: ApplicationCenterPageProps) {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: 'loading' })
  const [sidebarVisible, setSidebarVisible] = useState(getLlmWikiSidebarVisible)

  const inspect = useCallback(() => {
    setRuntime({ status: 'loading' })
    void inspectLlmWiki().then(
      (value) => { setRuntime({ status: 'ready', value }) },
      () => { setRuntime({ status: 'error' }) },
    )
  }, [inspectLlmWiki])

  useEffect(() => { inspect() }, [inspect])

  const available = runtime.status === 'ready' && runtime.value.available
  const configured = available && runtime.value.credentialConfigured
  const status = runtime.status === 'loading'
    ? t('applicationChecking')
    : runtime.status === 'error'
      ? t('applicationStatusError')
      : !runtime.value.available
        ? t('applicationUnavailable')
        : configured
          ? t('applicationReady')
          : t('applicationNeedsModel')

  const toggleSidebar = (): void => {
    const next = !sidebarVisible
    setLlmWikiSidebarVisible(next)
    setSidebarVisible(next)
  }

  return (
    <div className={css.root}>
      <div className={css.topbar}>
        <div className={css.identity}>
          <span className={css.topbarIcon} aria-hidden="true"><IconDataOutline16 size={16} /></span>
          <span>{t('applicationTitle')}</span>
        </div>
      </div>

      <main className={css.content}>
        <header className={css.hero}>
          <div>
            <h1>{t('applicationTitle')}</h1>
            <p>{t('applicationIntro')}</p>
          </div>
        </header>

        <div className={css.sourceTabs} role="tablist" aria-label={t('applicationSources')}>
          <button type="button" role="tab" aria-selected="true">{t('applicationOfficial')}</button>
        </div>

        <section className={css.catalog} aria-labelledby="application-official-heading">
          <div className={css.sectionHeading}>
            <div>
              <h2 id="application-official-heading">{t('applicationOfficial')}</h2>
              <p>{t('applicationOfficialHint')}</p>
            </div>
            <span>{t('applicationCount')}</span>
          </div>

          <article className={css.card} data-runtime={available ? (configured ? 'ready' : 'configuration') : 'unavailable'}>
            <WikiArtwork />
            <div className={css.cardBody}>
              <div className={css.cardTitle}>
                <h3>FF - LLM Wiki</h3>
                <span>{t('applicationOfficial')}</span>
              </div>
              <p className={css.description}>{t('applicationWikiDescription')}</p>
              <div className={css.capabilities}>
                <span>{t('applicationWikiCapabilityKnowledge')}</span>
                <span>{t('applicationWikiCapabilityGraph')}</span>
                <span>{t('applicationWikiCapabilityTrace')}</span>
              </div>
              <div className={css.runtime} aria-live="polite">
                <span className={css.statusDot} />
                <strong>{status}</strong>
                {runtime.status === 'error' || (runtime.status === 'ready' && !runtime.value.available) ? (
                  <button type="button" onClick={inspect}>
                    <IconRefreshOutline16 size={14} />
                    {t('applicationRetry')}
                  </button>
                ) : null}
              </div>
            </div>
            <div className={css.actions}>
              <label className={css.visibilityControl}>
                <span>{t('applicationShowInSidebar')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sidebarVisible}
                  aria-label={t('applicationShowInSidebar')}
                  data-checked={sidebarVisible || undefined}
                  disabled={!available}
                  onClick={toggleSidebar}
                >
                  <span />
                </button>
              </label>
              {available && !configured ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<IconSettingsOutline16 size={16} />}
                  onClick={openModelSettings}
                >
                  {t('applicationConfigureModel')}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                icon={<IconRightUpOutline16 size={16} />}
                disabled={!available}
                onClick={openLlmWiki}
              >
                {t('applicationOpen')}
              </Button>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
