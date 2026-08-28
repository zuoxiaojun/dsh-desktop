/** Persistent team attribution in the sidebar foot. */

import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import css from './DesktopCustomization.module.css'

/** Render the clickable team badge in the wide sidebar or compact rail. */
export function BrandBadge({ wide }: PropsRuntime<'sidebar.footer.action'>): ReactNode {
  return (
    <Tooltip label="DSH Desktop" delayMs={500} disabled={wide}>
      <a
        className={`${css.brandBadge}${wide ? '' : ` ${css.brandBadgeRail}`}`}
        href="https://github.com/gcw_cJbJuamU/dsh-desktop"
        target="_blank"
        rel="noreferrer"
        aria-label="查看 DSH Desktop 源码"
        title="DSH Desktop"
      >
        <img src="/dsh-desktop/dsh-logo.png" alt="" />
        {wide ? <span>DSH Desktop</span> : null}
      </a>
    </Tooltip>
  )
}
