import { createDemoOverview } from '@llmwiki/contracts'
import { Dashboard } from '../components/Dashboard'

export default function HomePage() {
  // 服务端先渲染内置基线数据，保证首屏非空白；
  // 客户端挂载后优先读取 API，成功后替换为实时数据。
  return <Dashboard initialData={createDemoOverview()} />
}
