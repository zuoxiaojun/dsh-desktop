'use client'

import { useEffect, useState } from 'react'
import type {
  EvalLatestResponse,
  OverviewResponse,
  WikiListResponse,
} from '@llmwiki/contracts'
import { RecentDocuments } from './RecentDocuments'
import { ProcessingProgress } from './ProcessingProgress'
import { KnowledgeGraphPreview } from './KnowledgeGraphPreview'
import { DashboardServiceLinks } from './DashboardServiceLinks'
import { KnowledgeAssetOverview } from './KnowledgeAssetOverview'
import { QualityEvaluationSummary } from './QualityEvaluationSummary'
import { fetchEvaluation, fetchOverview, fetchWikiList } from '../lib/api'

export function Dashboard({ initialData }: { initialData: OverviewResponse }) {
  const [data, setData] = useState<OverviewResponse>(initialData)
  const [wikiData, setWikiData] = useState<WikiListResponse | null>(null)
  const [evaluationData, setEvaluationData] = useState<EvalLatestResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchOverview()
      .then((res) => {
        if (!cancelled) {
          setData(res)
        }
      })
      .catch(() => {
        // API 暂不可用时保留首屏本地数据，避免工作台出现空白。
      })

    fetchWikiList()
      .then((res) => {
        if (!cancelled) setWikiData(res)
      })
      .catch(() => {
        // 首页资产卡保留最近一次编译结果。
      })

    fetchEvaluation()
      .then((res) => {
        if (!cancelled) setEvaluationData(res)
      })
      .catch(() => {
        // 首页评估卡保留最近一次质量报告。
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dashboard-home flex min-h-[calc(100dvh-5.3125rem)] flex-col gap-3 xl:h-[calc(100dvh-5.25rem)] xl:min-h-0">
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(380px,0.72fr)]">
        <KnowledgeAssetOverview data={wikiData} />
        <QualityEvaluationSummary data={evaluationData} />
      </section>

      <ProcessingProgress stages={data.processingProgress} />

      <section className="grid min-h-[290px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.28fr)_minmax(0,0.72fr)_minmax(310px,0.9fr)] 2xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)_minmax(380px,1fr)]">
        <RecentDocuments items={data.recentDocuments} />
        <KnowledgeGraphPreview />
        <DashboardServiceLinks />
      </section>
    </div>
  )
}
