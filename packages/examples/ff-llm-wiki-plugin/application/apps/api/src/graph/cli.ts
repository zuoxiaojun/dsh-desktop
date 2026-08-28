import { ensureWikiCompiled } from '../wiki/service.js'
import { extractGraph } from './extractor.js'

/**
 * `pnpm graph:extract` CLI 入口。
 * 运行确定性本地规则抽取：读真实编译产物 → 生成 output/kg_nodes.json 与 kg_edges.json。
 * 无模型、无网络，标注「本地规则抽取演示模式」。
 */
ensureWikiCompiled()
const result = extractGraph()

console.log('图谱抽取完成 ✔（本地规则抽取演示模式）')
console.log(`- 节点：${result.stats.nodes} 个 · 边：${result.stats.edges} 条`)
console.log(
  `- 节点类型：知识页 ${result.stats.pageNodes} · 来源文档 ${result.stats.sourceNodes} · 主题 ${result.stats.topicNodes} · 页面类型 ${result.stats.pageTypeNodes}`,
)
console.log(
  `- 边语义：内链 ${result.stats.interlinkEdges} · 来源 ${result.stats.sourceEdges} · 主题 ${result.stats.topicEdges} · 类型 ${result.stats.typeEdges}`,
)
console.log(`- 抽取时间：${result.generatedAt}`)
console.log('- 产物目录：output/（kg_nodes.json + kg_edges.json + kg_meta.json）')
