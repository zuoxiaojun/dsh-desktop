'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, isNavActive } from '../lib/nav'
import { Brand } from './Brand'

/** 桌面 / 平板侧边栏：md 图标栏，lg 展开完整导航。 */
export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-white/[0.07] bg-[#060a0c]/90 shadow-[18px_0_50px_rgba(0,0,0,0.16)] backdrop-blur-2xl md:flex lg:w-64">
      <div className="px-4 py-6 lg:px-5">
        <div className="hidden lg:block">
          <Brand />
        </div>
        <div className="flex justify-center lg:hidden">
          <Brand compact />
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-3 py-3 lg:px-4">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`group relative flex items-center justify-center gap-3 overflow-hidden rounded-xl px-3 py-3 text-[15px] font-medium transition-all lg:justify-start ${
                active
                  ? 'bg-emerald-300/[0.08] text-emerald-100 ring-1 ring-inset ring-emerald-300/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
              }`}
            >
              {active && (
                <span className="absolute inset-y-2 left-0 w-px bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]" />
              )}
              <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-emerald-200' : 'transition-colors group-hover:text-slate-200'}`} />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/[0.06] px-4 py-4 lg:px-5">
        <div className="hidden lg:block">
          <div className="text-[12px] tracking-[0.08em] text-slate-600">
            @2026 赋范空间 独家自研
          </div>
        </div>
      </div>
    </aside>
  )
}
