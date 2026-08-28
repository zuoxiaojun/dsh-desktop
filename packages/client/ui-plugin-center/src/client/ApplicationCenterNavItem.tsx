import { IconDataOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginCenterNavItem.module.css'

/** Registration-side navigation action for the independent Application Center. */
export interface ApplicationCenterNavInjected {
  readonly pageId: string
  readonly open: () => void
}

/** Full props of the sidebar Application Center entry. */
export type ApplicationCenterNavProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'pluginCenter'>
  & InjectFace<ApplicationCenterNavInjected>

/** First-level sidebar entry that opens Application Center. */
export function ApplicationCenterNavItem({ wide, primaryPage, pageId, open, t }: ApplicationCenterNavProps) {
  const selected = primaryPage === pageId
  return (
    <Tooltip label={t('applicationTitle')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`${css.entry}${wide ? '' : ` ${css.rail}`}`}
        aria-current={selected ? 'page' : undefined}
        aria-label={t('applicationTitle')}
        data-selected={selected || undefined}
        onClick={open}
      >
        <IconDataOutline16 size={wide ? 16 : 18} />
        {wide ? <span>{t('applicationTitle')}</span> : null}
      </button>
    </Tooltip>
  )
}
