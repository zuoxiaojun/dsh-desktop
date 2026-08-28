import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PresetSquarePanel, type PresetSquareInjected } from './PresetSquarePanel.tsx'
import css from './PresetSquarePage.module.css'

/** Operations provided to the independent Preset Square page. */
export type PresetSquarePageInjected = PresetSquareInjected

/** Full props assembled by the independent main-page renderer. */
export type PresetSquarePageProps =
  PropsRuntime<'main.page'>
  & PropsLocale<'pluginCenter'>
  & InjectFace<PresetSquarePageInjected>

/** Independent first-level page for Preset discovery and local management. */
export function PresetSquarePage({
  presetAvailable,
  presetDevelopment,
  presetMutationsEnabled,
  listPresetSquare,
  detailPresetSquare,
  previewPresetInstall,
  installPreset,
  checkPresetRuntime,
  installPresetRuntime,
  listLocalPresets,
  removeLocalPreset,
  describePresetCredentials,
  setPresetCredential,
  useLocalPreset,
  t,
}: PresetSquarePageProps) {
  return (
    <div
      className={css.root}
      data-development={presetDevelopment || undefined}
      title={presetDevelopment ? t('developmentMode') : undefined}
    >
      <div className={css.topbar}>
        <div className={css.identity}>
          <span className={css.icon} aria-hidden="true"><IconAgentPresetOutline16 size={16} /></span>
          <span>{t('presetTitle')}</span>
        </div>
      </div>
      <PresetSquarePanel
        presetAvailable={presetAvailable}
        presetDevelopment={presetDevelopment}
        presetMutationsEnabled={presetMutationsEnabled}
        listPresetSquare={listPresetSquare}
        detailPresetSquare={detailPresetSquare}
        previewPresetInstall={previewPresetInstall}
        installPreset={installPreset}
        checkPresetRuntime={checkPresetRuntime}
        installPresetRuntime={installPresetRuntime}
        listLocalPresets={listLocalPresets}
        removeLocalPreset={removeLocalPreset}
        describePresetCredentials={describePresetCredentials}
        setPresetCredential={setPresetCredential}
        useLocalPreset={useLocalPreset}
        t={t}
      />
    </div>
  )
}
