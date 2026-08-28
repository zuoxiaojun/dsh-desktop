'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Graph, NodeEvent } from '@antv/g6'
import type {
  GraphEdge,
  GraphEdgeSemantic,
  GraphNode,
  GraphNodeType,
} from '@llmwiki/contracts'
import {
  NODE_TYPE_COLOR,
  NODE_TYPE_LABEL,
  SEMANTIC_LABEL,
  SEMANTIC_WEIGHT,
} from '../lib/graph-adapt'

export interface G6KnowledgeGraphHandle {
  focusNode(id: string): void
  fitView(): void
  relayout(): void
}

interface G6KnowledgeGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  visibleTypes: Set<GraphNodeType>
  visibleSemantics: Set<GraphEdgeSemantic>
  onSelectNode: (id: string | null) => void
}

const CLUSTER_COLORS = [
  '#79d8b6',
  '#e3c36b',
  '#63b9b1',
  '#a9c98e',
  '#cf9865',
  '#789caf',
]

const EDGE_COLORS: Record<GraphEdgeSemantic, string> = {
  LINKS_TO: '#6fb49e',
  HAS_SOURCE: '#9d7d49',
  HAS_TOPIC: '#cbae5a',
  HAS_TYPE: '#647f8d',
}

type VisualNodeData = {
  label: string
  type: GraphNodeType
  cluster: string
  clusterLabel: string
  color: string
  degree: number
  sourceDoc: string
  showLabel: boolean
  centerX: number
  centerY: number
}

function nodeData(datum: { data?: Record<string, unknown> }): VisualNodeData {
  return datum.data as VisualNodeData
}

function makeTooltip(
  items: Array<{ data?: Record<string, unknown> }>,
  isLight: boolean,
): HTMLElement {
  const data = nodeData(items[0] ?? {})
  const root = document.createElement('div')
  root.style.cssText = [
    'min-width:188px',
    'max-width:252px',
    'padding:11px 13px 12px',
    `border:1px solid ${data.color}38`,
    'border-radius:13px',
    isLight
      ? 'background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(240,247,243,.98))'
      : 'background:linear-gradient(145deg,rgba(18,31,31,.98),rgba(6,14,16,.98))',
    isLight
      ? `box-shadow:0 20px 52px rgba(48,73,65,.16),0 0 25px ${data.color}16,inset 0 1px rgba(255,255,255,.9)`
      : `box-shadow:0 20px 52px rgba(0,0,0,.5),0 0 28px ${data.color}12,inset 0 1px rgba(255,255,255,.035)`,
    'backdrop-filter:blur(20px) saturate(120%)',
    `color:${isLight ? '#273532' : '#e2e8f0'}`,
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif",
  ].join(';')

  const type = document.createElement('div')
  type.innerHTML = `<span style="display:inline-block;width:5px;height:5px;margin-right:6px;border-radius:50%;background:${data.color};box-shadow:0 0 10px ${data.color}"></span>${NODE_TYPE_LABEL[data.type] ?? '知识节点'}`
  type.style.cssText = `display:flex;align-items:center;font-size:9px;letter-spacing:.14em;color:${data.color};text-transform:uppercase`
  const title = document.createElement('div')
  title.textContent = data.label
  title.style.cssText = `margin-top:7px;font-size:14px;line-height:1.45;font-weight:600;color:${isLight ? '#17231f' : '#f4f7f6'}`
  const meta = document.createElement('div')
  meta.textContent = `${data.clusterLabel} · ${data.degree} 条关系`
  meta.style.cssText = `margin-top:6px;padding-top:6px;border-top:1px solid ${isLight ? 'rgba(40,73,64,.1)' : 'rgba(148,163,184,.09)'};font-size:10px;color:${isLight ? '#75857f' : '#708087'}`
  root.append(type, title, meta)
  return root
}

export const G6KnowledgeGraph = forwardRef<G6KnowledgeGraphHandle, G6KnowledgeGraphProps>(
  function G6KnowledgeGraph(
    { nodes, edges, visibleTypes, visibleSemantics, onSelectNode },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const graphRef = useRef<Graph | null>(null)
    const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading')
    const [isLight, setIsLight] = useState(true)
    const onSelectRef = useRef(onSelectNode)
    onSelectRef.current = onSelectNode

    useEffect(() => {
      const syncTheme = () => setIsLight(document.documentElement.dataset.theme !== 'dark')
      syncTheme()
      const observer = new MutationObserver(syncTheme)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
      return () => observer.disconnect()
    }, [])

    const visual = useMemo(() => {
      const degree = new Map<string, number>()
      const clusterById = new Map<string, string>()
      const clusterLabelById = new Map<string, string>()
      const topicNodes = nodes
        .filter(node => node.type === 'TOPIC')
        .sort((a, b) => a.id.localeCompare(b.id))
      const topicColor = new Map(
        topicNodes.map((node, index) => [node.id, CLUSTER_COLORS[index % CLUSTER_COLORS.length]]),
      )
      const topicIndex = new Map(topicNodes.map((node, index) => [node.id, index]))

      for (const node of topicNodes) {
        clusterById.set(node.id, node.id)
        clusterLabelById.set(node.id, node.label ?? node.name)
      }

      for (const edge of edges) {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
        if (edge.semantic === 'HAS_TOPIC') {
          const topicId = topicColor.has(edge.target) ? edge.target : edge.source
          const pageId = topicId === edge.target ? edge.source : edge.target
          clusterById.set(pageId, topicId)
          clusterLabelById.set(pageId, nodes.find(node => node.id === topicId)?.label ?? '业务主题')
        }
      }

      // 来源节点继承其所连接知识页的业务主题，使展开来源时仍保持清晰分区。
      for (const edge of edges) {
        if (edge.semantic !== 'HAS_SOURCE') continue
        const sourceNode = nodes.find(node => node.id === edge.target && node.type === 'SOURCE')
          ?? nodes.find(node => node.id === edge.source && node.type === 'SOURCE')
        const pageId = sourceNode?.id === edge.target ? edge.source : edge.target
        const cluster = clusterById.get(pageId)
        if (sourceNode && cluster) {
          clusterById.set(sourceNode.id, cluster)
          clusterLabelById.set(sourceNode.id, clusterLabelById.get(pageId) ?? '业务主题')
        }
      }

      // 页面类型同样继承知识页的主题，保证全量节点展开后仍收束在对应业务域中。
      for (const edge of edges) {
        if (edge.semantic !== 'HAS_TYPE') continue
        const typeNode = nodes.find(node => node.id === edge.target && node.type === 'PAGE_TYPE')
          ?? nodes.find(node => node.id === edge.source && node.type === 'PAGE_TYPE')
        const pageId = typeNode?.id === edge.target ? edge.source : edge.target
        const cluster = clusterById.get(pageId)
        if (typeNode && cluster) {
          clusterById.set(typeNode.id, cluster)
          clusterLabelById.set(typeNode.id, clusterLabelById.get(pageId) ?? '业务主题')
        }
      }

      const visibleNodeList = nodes.filter(node => visibleTypes.has(node.type))
      const visibleNodeIds = new Set(visibleNodeList.map(node => node.id))
      const visibleEdgeList = edges.filter(
        edge =>
          visibleSemantics.has(edge.semantic)
          && visibleNodeIds.has(edge.source)
          && visibleNodeIds.has(edge.target),
      )
      const labeledPageIds = new Set(
        visibleNodeList
          .filter(node => node.type === 'PAGE')
          .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
          .slice(0, 12)
          .map(node => node.id),
      )

      const clusterMembers = new Map<string, GraphNode[]>()
      for (const node of visibleNodeList) {
        const cluster = clusterById.get(node.id) ?? `type-${node.type}`
        const members = clusterMembers.get(cluster) ?? []
        members.push(node)
        clusterMembers.set(cluster, members)
      }

      // 固定六个业务域的中心，再把成员编排成双层轨道。
      // 这比随机力导向更稳定，也能让每次打开页面都得到可讲解的构图。
      const placements = new Map<string, { x: number; y: number }>()
      for (const [cluster, members] of clusterMembers) {
        const clusterIndex = topicIndex.get(cluster) ?? 0
        const column = clusterIndex % 3
        const row = Math.floor(clusterIndex / 3)
        const centerX = 220 + column * 390 + (row === 1 ? 36 : 0)
        const centerY = 150 + row * 280
        const topic = members.find(node => node.type === 'TOPIC')
        if (topic) placements.set(topic.id, { x: centerX, y: centerY })

        const orbiting = members
          .filter(node => node.type !== 'TOPIC')
          .sort((a, b) => {
            const priority: Record<GraphNodeType, number> = {
              PAGE: 0,
              SOURCE: 1,
              PAGE_TYPE: 2,
              TOPIC: 3,
            }
            return priority[a.type] - priority[b.type] || a.id.localeCompare(b.id)
          })

        orbiting.forEach((node, index) => {
          const firstRing = index < 6
          const ringIndex = firstRing ? index : index - 6
          const ringCount = firstRing
            ? Math.min(6, orbiting.length)
            : Math.max(1, orbiting.length - 6)
          const radius = firstRing ? 70 : 126
          const angle = -Math.PI / 2 + (ringIndex / ringCount) * Math.PI * 2 + clusterIndex * 0.17
          placements.set(node.id, {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius * 0.72,
          })
        })
      }

      const g6Nodes = visibleNodeList.map((node) => {
        const cluster = clusterById.get(node.id) ?? `type-${node.type}`
        const color = topicColor.get(cluster) ?? NODE_TYPE_COLOR[node.type]
        const nodeDegree = degree.get(node.id) ?? 0
        const position = placements.get(node.id) ?? { x: 610, y: 290 }
        return {
          id: node.id,
          style: { x: position.x, y: position.y },
          data: {
            label: node.label ?? node.name,
            type: node.type,
            cluster,
            clusterLabel: clusterLabelById.get(node.id) ?? NODE_TYPE_LABEL[node.type],
            color,
            degree: nodeDegree,
            sourceDoc: node.source_doc,
            showLabel: node.type === 'TOPIC' || labeledPageIds.has(node.id),
            centerX: position.x,
            centerY: position.y,
          } satisfies VisualNodeData,
        }
      })

      const g6Edges = visibleEdgeList.map((edge, index) => ({
        id: `${edge.source}--${edge.target}--${edge.semantic}--${index}`,
        source: edge.source,
        target: edge.target,
        data: {
          semantic: edge.semantic,
          label: edge.label ?? SEMANTIC_LABEL[edge.semantic],
          weight: SEMANTIC_WEIGHT[edge.semantic] ?? 1,
          color: EDGE_COLORS[edge.semantic],
        },
      }))

      const groups = new Map<string, { label: string; color: string; members: string[] }>()
      for (const node of g6Nodes) {
        const data = node.data
        if (data.cluster.startsWith('type-')) continue
        const group = groups.get(data.cluster) ?? {
          label: data.clusterLabel,
          color: data.color,
          members: [],
        }
        group.members.push(node.id)
        groups.set(data.cluster, group)
      }

      return { nodes: g6Nodes, edges: g6Edges, groups }
    }, [nodes, edges, visibleTypes, visibleSemantics])

    useImperativeHandle(ref, () => ({
      focusNode(id) {
        const graph = graphRef.current
        if (!graph) return
        void graph.setElementState(id, 'selected', true)
        void graph.focusElement(id, { duration: 700, easing: 'ease-in-out' })
      },
      fitView() {
        void graphRef.current?.fitView(
          { when: 'always', direction: 'both' },
          { duration: 800, easing: 'ease-in-out' },
        )
      },
      relayout() {
        const graph = graphRef.current
        if (!graph) return
        void graph.fitView(
          { when: 'always', direction: 'both' },
          { duration: 800, easing: 'ease-in-out' },
        )
      },
    }))

    useEffect(() => {
      const container = containerRef.current
      if (!container || visual.nodes.length === 0) return

      let disposed = false
      let resizeObserver: ResizeObserver | null = null
      let readyTimer: number | null = null
      setRenderState('loading')
      container.replaceChildren()

      const bubblePlugins = [...visual.groups.entries()]
        .filter(([, group]) => group.members.length >= 3)
        .map(([clusterId, group], index) => ({
          type: 'bubble-sets',
          key: `knowledge-domain-${index}`,
          members: group.members,
          labelText: group.label,
          labelFill: group.color,
          labelFontSize: 11,
          labelFontWeight: 600,
          labelBackground: true,
          labelBackgroundFill: isLight ? 'rgba(247,250,248,.92)' : 'rgba(7,16,18,.88)',
          labelBackgroundRadius: 8,
          labelPadding: [5, 8],
          fill: group.color,
          fillOpacity: isLight ? 0.085 : 0.06,
          stroke: group.color,
          strokeOpacity: isLight ? 0.36 : 0.3,
          lineWidth: 1.2,
          lineDash: [5, 7],
          nodeR0: 8,
          nodeR1: 18,
          morphBuffer: 14,
          virtualEdges: [],
          clusterId,
        }))

      let graph: Graph
      try {
        graph = new Graph({
          container,
          data: { nodes: visual.nodes, edges: visual.edges },
          theme: isLight ? 'light' : 'dark',
          background: isLight ? '#f4f8f6' : '#071012',
          padding: [58, 72, 58, 72],
          autoFit: {
            type: 'view',
            options: { when: 'always', direction: 'both' },
            animation: { duration: 900, easing: 'ease-in-out' },
          },
          animation: { duration: 420, easing: 'ease-out' },
          node: {
            type: 'circle',
            style: (datum) => {
              const data = nodeData(datum)
              const isTopic = data.type === 'TOPIC'
              const size = isTopic ? 48 : 18 + Math.min(12, Math.sqrt(data.degree) * 2.6)
              return {
                x: data.centerX,
                y: data.centerY,
                size,
                fill: data.color,
                fillOpacity: isTopic ? (isLight ? 0.28 : 0.34) : isLight ? 0.075 : 0.1,
                stroke: data.color,
                strokeOpacity: isTopic ? 1 : isLight ? 0.76 : 0.86,
                lineWidth: isTopic ? 2.2 : 1.35,
                shadowColor: data.color,
                shadowBlur: isTopic ? (isLight ? 24 : 32) : data.degree >= 7 ? 17 : 9,
                cursor: 'pointer',
                halo: true,
                haloStroke: data.color,
                haloLineWidth: isTopic ? 10 : data.degree >= 7 ? 6 : 4,
                haloOpacity: isTopic ? 0.16 : data.degree >= 7 ? 0.09 : 0.045,
                label: data.showLabel,
                labelText: data.label,
                labelPlacement: 'bottom',
                labelOffsetY: isTopic ? 8 : 5,
                labelFontSize: isTopic ? 12 : 10,
                labelFontWeight: isTopic ? 600 : 500,
                labelFill: isLight
                  ? isTopic ? '#17231f' : '#526560'
                  : isTopic ? '#f8fafc' : '#aebdc2',
                labelBackground: true,
                labelBackgroundFill: isLight ? 'rgba(248,251,249,.9)' : 'rgba(7,16,18,.84)',
                labelBackgroundStroke: isTopic
                  ? `${data.color}55`
                  : isLight ? 'rgba(40,73,64,.1)' : 'rgba(148,163,184,.08)',
                labelBackgroundRadius: 7,
                labelPadding: isTopic ? [5, 8] : [3, 6],
                labelWordWrap: true,
                labelMaxWidth: 112,
              }
            },
            state: {
              active: {
                opacity: 1,
                lineWidth: 2.5,
                halo: true,
                haloLineWidth: 12,
                haloOpacity: 0.2,
                label: true,
                labelFill: isLight ? '#10221c' : '#ffffff',
              },
              inactive: { opacity: 0.12, labelOpacity: 0.08 },
              selected: {
                opacity: 1,
                lineWidth: 3,
                halo: true,
                haloLineWidth: 15,
                haloOpacity: 0.25,
                label: true,
                labelFill: isLight ? '#10221c' : '#ffffff',
              },
              unselected: { opacity: 0.09, labelOpacity: 0.05 },
            },
          },
          edge: {
            type: datum => datum.data?.semantic === 'LINKS_TO' ? 'quadratic' : 'line',
            style: (datum) => {
              const data = datum.data as {
                semantic: GraphEdgeSemantic
                color: string
                weight: number
              }
              return {
                stroke: data.color,
                strokeOpacity: isLight
                  ? data.semantic === 'HAS_TOPIC'
                    ? 0.5
                    : data.semantic === 'HAS_SOURCE'
                      ? 0.32
                      : data.semantic === 'HAS_TYPE'
                        ? 0.28
                        : 0.16
                  :
                  data.semantic === 'HAS_TOPIC'
                    ? 0.44
                    : data.semantic === 'HAS_SOURCE'
                      ? 0.24
                      : data.semantic === 'HAS_TYPE'
                        ? 0.2
                        : 0.13,
                lineWidth: data.semantic === 'HAS_TOPIC' ? 1.25 : Math.max(0.65, data.weight * 0.52),
                lineDash: data.semantic === 'HAS_SOURCE' ? [3, 5] : undefined,
                cursor: 'pointer',
              }
            },
            state: {
              active: { strokeOpacity: 0.9, lineWidth: 2.2 },
              inactive: { strokeOpacity: 0.025 },
              selected: { strokeOpacity: 0.95, lineWidth: 2.5 },
              unselected: { strokeOpacity: 0.018 },
            },
          },
          behaviors: [
            'drag-canvas',
            'zoom-canvas',
            { type: 'drag-element', enable: (event: { targetType?: string }) => event.targetType === 'node' },
            { type: 'hover-activate', degree: 1, state: 'active' },
            {
              type: 'click-select',
              degree: 1,
              multiple: false,
              state: 'selected',
              neighborState: 'active',
            },
          ],
          plugins: [
            ...bubblePlugins,
            {
              type: 'tooltip',
              key: 'knowledge-tooltip',
              trigger: 'hover',
              enable: (event: { targetType?: string }) => event.targetType === 'node',
              getContent: async (_event: unknown, items: Array<{ data?: Record<string, unknown> }>) => makeTooltip(items, isLight),
              onOpenChange: () => {},
            },
          ],
        } as ConstructorParameters<typeof Graph>[0])
      } catch (error) {
        console.error('G6 knowledge graph initialization failed', error)
        setRenderState('error')
        return
      }

      graphRef.current = graph
      graph.on(NodeEvent.CLICK, (event) => {
        const target = (event as { target?: { id?: string } }).target
        if (target?.id) onSelectRef.current(String(target.id))
      })

      const renderPromise = graph.render()
      readyTimer = window.setTimeout(() => {
        if (!disposed) setRenderState('ready')
      }, 520)
      void renderPromise
        .then(() => {
          if (disposed) return
          setRenderState('ready')
          return graph.fitView(
            { when: 'always', direction: 'both' },
            { duration: 900, easing: 'ease-in-out' },
          )
        })
        .catch((error: unknown) => {
          if (disposed) return
          console.error('G6 knowledge graph rendering failed', error)
          setRenderState('error')
        })

      resizeObserver = new ResizeObserver(() => {
        if (!disposed) graph.resize()
      })
      resizeObserver.observe(container)

      return () => {
        disposed = true
        if (readyTimer !== null) window.clearTimeout(readyTimer)
        resizeObserver?.disconnect()
        if (graphRef.current === graph) graphRef.current = null
        graph.destroy()
      }
    }, [visual, isLight])

    return (
      <div className={`g6-knowledge-graph relative h-full w-full overflow-hidden ${isLight ? 'bg-[#f4f8f6]' : 'bg-[#071012]'}`}>
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage: isLight
              ? 'radial-gradient(circle at 50% 42%,rgba(16,185,129,.07),transparent 38%),linear-gradient(rgba(38,82,70,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(38,82,70,.035) 1px,transparent 1px)'
              : 'radial-gradient(circle at 50% 42%,rgba(121,216,182,.055),transparent 38%),linear-gradient(rgba(121,216,182,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(121,216,182,.018) 1px,transparent 1px)',
            backgroundSize: 'auto,32px 32px,32px 32px',
          }}
        />
        <div ref={containerRef} className="relative z-10 h-full w-full" />
        {renderState !== 'ready' && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className={`rounded-2xl border border-emerald-300/15 px-5 py-3 text-[13px] tracking-[0.12em] shadow-2xl backdrop-blur-xl ${isLight ? 'bg-white/90 text-emerald-800/70' : 'bg-[#071012]/90 text-emerald-100/70'}`}>
              {renderState === 'error' ? '图谱画布初始化失败' : '正在组织业务知识域…'}
            </div>
          </div>
        )}
        <div className={`pointer-events-none absolute bottom-4 left-4 z-20 rounded-full border px-3 py-1.5 text-[12px] backdrop-blur-xl ${isLight ? 'border-emerald-900/10 bg-white/80 text-slate-500' : 'border-emerald-300/10 bg-[#071012]/80 text-slate-500'}`}>
          拖拽探索 · 滚轮缩放 · 点击聚焦一跳关系
        </div>
      </div>
    )
  },
)
