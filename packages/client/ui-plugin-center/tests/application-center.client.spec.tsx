// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApplicationCenterPage, type ApplicationCenterPageProps,
} from '../src/client/ApplicationCenterPage.tsx'
import { zh, type PluginCenterLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginCenterLocaleKey): string => zh[key]) as ApplicationCenterPageProps['t']

function props(values: Partial<ApplicationCenterPageProps> = {}): ApplicationCenterPageProps {
  return {
    inspectLlmWiki: async () => ({ available: true, credentialConfigured: true }),
    openLlmWiki: () => {},
    openModelSettings: () => {},
    getLlmWikiSidebarVisible: () => true,
    setLlmWikiSidebarVisible: () => {},
    t,
    ...values,
  } as ApplicationCenterPageProps
}

describe('Application Center', () => {
  it('shows the real ready state and opens LLM Wiki', async () => {
    const openLlmWiki = vi.fn()
    render(<ApplicationCenterPage {...props({ openLlmWiki })} />)

    expect(await screen.findByText(zh.applicationReady)).toBeTruthy()
    expect(screen.getByText('FF - LLM Wiki')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.applicationOpen }))
    expect(openLlmWiki).toHaveBeenCalledOnce()
  })

  it('guides missing credentials to model settings while keeping the application launch available', async () => {
    const openModelSettings = vi.fn()
    render(<ApplicationCenterPage {...props({
      inspectLlmWiki: async () => ({ available: true, credentialConfigured: false }),
      openModelSettings,
    })} />)

    expect(await screen.findByText(zh.applicationNeedsModel)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.applicationConfigureModel }))
    expect(openModelSettings).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: zh.applicationOpen }).hasAttribute('disabled')).toBe(false)
  })

  it('does not claim an unavailable Host application is installed and supports rechecking', async () => {
    const inspectLlmWiki = vi.fn(async () => ({ available: false, credentialConfigured: false }))
    render(<ApplicationCenterPage {...props({ inspectLlmWiki })} />)

    expect(await screen.findByText(zh.applicationUnavailable)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.applicationOpen }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.applicationRetry }))
    expect(inspectLlmWiki).toHaveBeenCalledTimes(2)
  })

  it('persists the sidebar launcher visibility immediately', async () => {
    const setLlmWikiSidebarVisible = vi.fn()
    render(<ApplicationCenterPage {...props({ setLlmWikiSidebarVisible })} />)

    await screen.findByText(zh.applicationReady)
    const visibility = screen.getByRole('switch', { name: zh.applicationShowInSidebar })
    expect(visibility.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(visibility)
    expect(setLlmWikiSidebarVisible).toHaveBeenCalledWith(false)
    expect(visibility.getAttribute('aria-checked')).toBe('false')
  })
})
