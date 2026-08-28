import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { AppShell } from '../components/AppShell'

export const metadata: Metadata = {
  title: 'FF - LLM Wiki 企业知识库',
  description: '面向企业资料的智能知识库系统',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body className="min-h-screen antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
