/** Windows catalog headers keep renderer controls outside native caption buttons. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = [
  '../src/client/PluginDiscoveryPage.module.css',
  '../src/client/PluginCenterTab.module.css',
].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))

describe('plugin catalog desktop title bars', () => {
  it.each(styles)('reserves the Windows caption-control lane', (css) => {
    const windowsTopbar = css.match(
      /:global\(html\[data-dsh-desktop-platform='win32'\]\) \.topbar\s*\{([^}]*)}/s,
    )?.[1]
    expect(windowsTopbar).toContain(
      'padding-right: calc(12px + var(--dsh-windows-caption-controls-width));',
    )
  })
})
