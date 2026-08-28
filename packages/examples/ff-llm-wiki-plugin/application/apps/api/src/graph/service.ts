import { existsSync, readFileSync } from 'node:fs'
import type {
  GraphCounts,
  GraphEdge,
  GraphEdgeSemantic,
  GraphEdgesResponse,
  GraphExtractResult,
  GraphNode,
  GraphNodeType,
  GraphNodesResponse,
  GraphOverviewResponse,
} from '@llmwiki/contracts'
import { ensureWikiCompiled } from '../wiki/service.js'
import {
  countGraph,
  edgeSemanticDistribution,
  extractGraph,
  nodeTypeDistribution,
} from './extractor.js'
import { KG_EDGES_PATH, KG_META_PATH, KG_NODES_PATH } from './paths.js'

/**
 * 图谱数据服务：以 output/ 下的真实产物（kg_nodes.json / kg_edges.json / kg_meta.json）
 * 为唯一事实来源。所有统计都从这两个数组实时计算，不散落硬编码数字。
 */

interface GraphMeta {
  schemaVersion: number
  mode: 'local-rule-extraction'
  generatedAt: string
  extractedBy: string
  sourceManifest: string
  sourceManifestCompiledAt: string
}

/** 首次使用若产物缺失则真实运行管道，保证默认进入即装满。 */
export function ensureGraphExtracted(): void {
  if (!existsSync(KG_NODES_PATH) || !existsSync(KG_EDGES_PATH) || !existsSync(KG_META_PATH)) {
    ensureWikiCompiled()
    extractGraph()
  }
}

function readNodes(): GraphNode[] {
  return JSON.parse(readFileSync(KG_NODES_PATH, 'utf8')) as GraphNode[]
}

function readEdges(): GraphEdge[] {
  return JSON.parse(readFileSync(KG_EDGES_PATH, 'utf8')) as GraphEdge[]
}

function readMeta(): GraphMeta {
  return JSON.parse(readFileSync(KG_META_PATH, 'utf8')) as GraphMeta
}

/** 图谱概览：统计全部从真实输出文件计算，时间/模式来自 kg_meta.json */
export function getGraphOverview(): GraphOverviewResponse {
  ensureGraphExtracted()
  const nodes = readNodes()
  const edges = readEdges()
  const meta = readMeta()
  return {
    mode: meta.mode,
    stats: countGraph(nodes, edges),
    nodeTypes: nodeTypeDistribution(nodes),
    edgeSemantics: edgeSemanticDistribution(edges),
    generatedAt: meta.generatedAt,
    sourceManifestCompiledAt: meta.sourceManifestCompiledAt,
  }
}

/** 节点列表（可按类型筛选），统计从返回前实时计算 */
export function listGraphNodes(type?: GraphNodeType): GraphNodesResponse {
  ensureGraphExtracted()
  const nodes = readNodes()
  const filtered = type ? nodes.filter(n => n.type === type) : nodes
  return {
    nodes: filtered,
    total: filtered.length,
    types: nodeTypeDistribution(nodes),
  }
}

/** 边列表（可按语义筛选），统计从返回前实时计算 */
export function listGraphEdges(semantic?: GraphEdgeSemantic): GraphEdgesResponse {
  ensureGraphExtracted()
  const edges = readEdges()
  const filtered = semantic ? edges.filter(e => e.semantic === semantic) : edges
  return {
    edges: filtered,
    total: filtered.length,
    semantics: edgeSemanticDistribution(edges),
  }
}

/** 重新抽取：真实重跑本地规则管道并更新生成时间（不碰 raw/） */
export function reextractGraph(): GraphExtractResult {
  return extractGraph()
}

/** 供调用方取计数（测试 / 调试用） */
export function readGraphCounts(): GraphCounts {
  ensureGraphExtracted()
  return countGraph(readNodes(), readEdges())
}
