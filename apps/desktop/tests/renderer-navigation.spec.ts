import { describe, expect, it } from 'vitest'
import {
  PLUGIN_CENTER_INSTALLED_VIEW,
  PLUGIN_CENTER_PAGE_ID,
  PLUGIN_CENTER_VIEW_PARAMETER,
  desktopRendererUrl,
} from '../src/renderer-navigation.ts'

describe('desktop renderer navigation', () => {
  it('retains the expanded installed manager across a Plugin Center Host replacement', () => {
    const previous = new URL('http://127.0.0.1:4101/')
    previous.searchParams.set(PLUGIN_CENTER_VIEW_PARAMETER, PLUGIN_CENTER_INSTALLED_VIEW)

    const next = new URL(desktopRendererUrl({
      origin: 'http://127.0.0.1:4102/',
      platform: 'darwin',
      primaryPage: PLUGIN_CENTER_PAGE_ID,
      previousUrl: previous.href,
    }))

    expect(next.origin).toBe('http://127.0.0.1:4102')
    expect(next.searchParams.get('dsh-primary-page')).toBe(PLUGIN_CENTER_PAGE_ID)
    expect(next.searchParams.get(PLUGIN_CENTER_VIEW_PARAMETER)).toBe(PLUGIN_CENTER_INSTALLED_VIEW)
  })

  it('does not retain arbitrary renderer parameters or a Plugin Center view on another page', () => {
    const next = new URL(desktopRendererUrl({
      origin: 'http://127.0.0.1:4102/',
      platform: 'darwin',
      primaryPage: 'plugin-discovery',
      previousUrl: 'http://127.0.0.1:4101/?dsh-plugin-center-view=installed&unsafe=value',
    }))

    expect(next.searchParams.get('dsh-primary-page')).toBe('plugin-discovery')
    expect(next.searchParams.has(PLUGIN_CENTER_VIEW_PARAMETER)).toBe(false)
    expect(next.searchParams.has('unsafe')).toBe(false)
  })
})
