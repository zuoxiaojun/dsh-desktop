// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement, type ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../../../examples/ff-llm-wiki-plugin/src/client/Plugin.tsx'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('FF - LLM Wiki sidebar visibility', () => {
  it('removes and restores the launcher when the shared preference changes', async () => {
    window.localStorage.setItem('ff-llm-wiki:sidebar-visible', 'true')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'sidebar.primary.action': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('sidebar.primary.action').find(item => item.options.id === 'ff-llm-wiki')
    expect(entry).toBeDefined()
    const Nav = entry!.component as ComponentType<Record<string, unknown>>
    render(createElement(Nav, {
      wide: true,
      primaryPage: undefined,
      t: (key: string) => key === 'nav' ? 'FF - LLM Wiki' : key,
    }))
    expect(screen.getByRole('button', { name: /FF - LLM Wiki/ })).toBeTruthy()

    act(() => {
      window.localStorage.setItem('ff-llm-wiki:sidebar-visible', 'false')
      window.dispatchEvent(new CustomEvent('ff-llm-wiki:sidebar-visibility'))
    })
    expect(screen.queryByRole('button', { name: /FF - LLM Wiki/ })).toBeNull()

    act(() => {
      window.localStorage.setItem('ff-llm-wiki:sidebar-visible', 'true')
      window.dispatchEvent(new CustomEvent('ff-llm-wiki:sidebar-visibility'))
    })
    expect(screen.getByRole('button', { name: /FF - LLM Wiki/ })).toBeTruthy()

    await ctx.fiber.dispose()
  })

  it('keeps the launcher hidden by default before it first renders', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'sidebar.primary.action': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('sidebar.primary.action').find(item => item.options.id === 'ff-llm-wiki')!
    const Nav = entry.component as ComponentType<Record<string, unknown>>
    render(createElement(Nav, {
      wide: true,
      primaryPage: undefined,
      t: (key: string) => key === 'nav' ? 'FF - LLM Wiki' : key,
    }))
    expect(screen.queryByRole('button', { name: /FF - LLM Wiki/ })).toBeNull()

    await ctx.fiber.dispose()
  })
})
