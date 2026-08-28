/** Pure URL composition for Desktop renderer navigation across Host generations. */

const PRIMARY_PAGE_PARAMETER = 'dsh-primary-page'
/** Stable first-level page id for the Desktop Plugin Center. */
export const PLUGIN_CENTER_PAGE_ID = 'plugin-center'
/** Renderer URL parameter retaining the Plugin Center subview across a controlled Host replacement. */
export const PLUGIN_CENTER_VIEW_PARAMETER = 'dsh-plugin-center-view'
/** URL value selecting the expanded installed-plugin manager. */
export const PLUGIN_CENTER_INSTALLED_VIEW = 'installed'

/** Inputs for one trusted loopback renderer URL. */
export interface DesktopRendererUrlOptions {
  readonly origin: string
  readonly platform: NodeJS.Platform
  readonly primaryPage?: string
  readonly previousUrl: string
}

/**
 * Compose the next Host URL while retaining only explicitly supported local viewing state.
 * @param options - Replacement origin, platform, requested page, and current renderer URL.
 * @returns A trusted renderer URL for the replacement Host generation.
 */
export function desktopRendererUrl(options: DesktopRendererUrlOptions): string {
  const url = new URL(options.origin)
  url.searchParams.set('dsh-desktop-platform', options.platform)
  if (options.primaryPage !== undefined) {
    url.searchParams.set(PRIMARY_PAGE_PARAMETER, options.primaryPage)
  }
  if (options.primaryPage !== PLUGIN_CENTER_PAGE_ID) return url.href
  try {
    const previous = new URL(options.previousUrl)
    if (previous.searchParams.get(PLUGIN_CENTER_VIEW_PARAMETER) === PLUGIN_CENTER_INSTALLED_VIEW) {
      url.searchParams.set(PLUGIN_CENTER_VIEW_PARAMETER, PLUGIN_CENTER_INSTALLED_VIEW)
    }
  } catch {
    // An empty or non-URL initial renderer state carries no trusted view selection.
  }
  return url.href
}
