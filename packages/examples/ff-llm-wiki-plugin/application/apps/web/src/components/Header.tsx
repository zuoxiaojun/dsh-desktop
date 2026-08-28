'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, isNavActive } from '../lib/nav'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'

/** 顶部栏：移动端横向导航 + 统一品牌与主题切换。 */
export function Header() {
  const pathname = usePathname()

  return (
    <header className="app-header sticky top-0 z-30 border-b border-white/[0.07] bg-[#070c0e]/82 backdrop-blur-2xl">
      {/* 移动端横向导航 */}
      <nav className="flex items-center gap-1 overflow-x-auto px-3 py-2 md:hidden">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-emerald-300/10 text-emerald-100 ring-1 ring-inset ring-emerald-300/25'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="flex w-full items-center justify-between gap-4 px-5 py-3 sm:px-6 lg:px-7">
        <div className="md:hidden">
          <Brand />
        </div>

        <div className="ml-auto flex items-center justify-end">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
