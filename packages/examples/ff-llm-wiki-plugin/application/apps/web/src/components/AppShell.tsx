import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell relative min-h-screen bg-grid">
      {/* 黑曜底盘上的低强度状态氛围，仅用于拉开全局层次。 */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-48 left-[38%] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-emerald-400/[0.045] blur-[130px]" />
        <div className="absolute bottom-[-120px] right-[-80px] h-[360px] w-[560px] rounded-full bg-amber-400/[0.035] blur-[140px]" />
      </div>

      <Sidebar />

      <div className="relative z-10 md:pl-20 lg:pl-64">
        <Header />
        <main className="mx-auto w-full max-w-[1800px] px-3 py-3 sm:px-4 lg:px-3">
          {children}
        </main>
      </div>
    </div>
  )
}
