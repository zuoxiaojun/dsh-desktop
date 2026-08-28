import { IconAgentPresetOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginCenterNavItem.module.css'

/** Registration-side navigation action for the independent Preset Square. */
export interface PresetSquareNavInjected {
  readonly pageId: string
  readonly open: () => void
}

/** Full props of the sidebar Preset Square entry. */
export type PresetSquareNavProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'pluginCenter'>
  & InjectFace<PresetSquareNavInjected>

/** First-level sidebar entry that opens Preset Square. */
export function PresetSquareNavItem({ wide, primaryPage, pageId, open, t }: PresetSquareNavProps) {
  const selected = primaryPage === pageId
  return (
    <Tooltip label={t('presetTitle')} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={`${css.entry}${wide ? '' : ` ${css.rail}`}`}
        aria-current={selected ? 'page' : undefined}
        aria-label={t('presetTitle')}
        data-selected={selected || undefined}
        onClick={open}
      >
        <IconAgentPresetOutline16 size={wide ? 16 : 18} />
        {wide ? <span>{t('presetTitle')}</span> : null}
      </button>
    </Tooltip>
  )
}
