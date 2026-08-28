'use client'

import { useEffect, useState } from 'react'

/**
 * 明暗主题切换：默认暗色，用户选择写入 localStorage 并在刷新后保持。
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('llmwiki-theme')
    const initial = saved !== 'light'
    setDark(initial)
    document.documentElement.dataset.theme = initial ? 'dark' : 'light'
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    localStorage.setItem('llmwiki-theme', next ? 'dark' : 'light')
    window.dispatchEvent(
      new CustomEvent('llmwiki-theme-change', { detail: next ? 'dark' : 'light' }),
    )
  }

  return (
    <button
      onClick={toggle}
      aria-label="切换明暗主题"
      title={dark ? '切换到浅色主题' : '切换到深色主题'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[15px] text-slate-300 transition-colors hover:border-emerald-300/30 hover:bg-emerald-300/[0.07] hover:text-slate-100"
    >
      <span aria-hidden className="text-[15px] leading-none">{dark ? '☀' : '☾'}</span>
    </button>
  )
}
