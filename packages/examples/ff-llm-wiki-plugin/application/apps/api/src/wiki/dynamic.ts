import type {
  DocumentChunkView,
  DocumentRecord,
  WikiPageType,
} from '@llmwiki/contracts'
import type { SqliteKnowledgeRepository } from '../data/knowledge-sqlite.js'
import type { ManifestPage } from './compiler.js'

const PIPELINE_VERSION = 3

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripInlineMarkdown(text: string): string {
  return compact(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<https?:\/\/[^>]+>/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/, '')
      .replace(/^\s*\[[ xX]\]\s*/, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\([`*_{}\[\]()#+.!-])/g, '$1'),
  )
}

function splitLongBlock(text: string, max = 420): string[] {
  if (text.length <= max) return [text]
  const sentences = text.split(/(?<=[。！？；])\s*/).filter(Boolean)
  const parts: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > max) {
      parts.push(current)
      current = ''
    }
    current += sentence
  }
  if (current) parts.push(current)
  return parts.length > 0 ? parts : [text.slice(0, max)]
}

/** Markdown / TXT → 适合 Wiki 阅读和检索的干净知识块。 */
export function buildKnowledgeBlocks(text: string): string[] {
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const blocks: string[] = []
  let paragraph: string[] = []
  let heading = ''
  let inCodeFence = false

  const add = (value: string, withHeading = true) => {
    const clean = stripInlineMarkdown(value)
    if (clean.length < 16) return
    const contextual = withHeading && heading && !clean.startsWith(heading)
      ? `${heading}：${clean}`
      : clean
    for (const part of splitLongBlock(contextual)) {
      const normalized = truncate(part, 440)
      if (!blocks.includes(normalized)) blocks.push(normalized)
    }
  }
  const flush = () => {
    if (paragraph.length > 0) add(paragraph.join(' '))
    paragraph = []
  }

  for (const rawLine of withoutFrontmatter.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^```/.test(line)) {
      flush()
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue
    if (!line) {
      flush()
      continue
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flush()
      heading = headingMatch[1].length === 1 ? '' : stripInlineMarkdown(headingMatch[2])
      continue
    }
    if (/^[|:\-\s]+$/.test(line) || /[├└│┌┐┘┬┴┼─]{2,}/.test(line)) {
      flush()
      continue
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      flush()
      const cells = line
        .slice(1, -1)
        .split('|')
        .map(stripInlineMarkdown)
        .filter(Boolean)
      if (cells.length >= 2 && !/^层$|^命令$|^变量$|^项目$/.test(cells[0])) {
        add(`${cells[0]}：${cells.slice(1).join('；')}`)
      }
      continue
    }
    if (/^(?:[-+*]|\d+[.)])\s+/.test(line) || /^>\s+/.test(line)) {
      flush()
      add(line)
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}

function truncate(text: string, max: number): string {
  const value = compact(text)
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function inferPageType(title: string): WikiPageType {
  if (/制度|规范|标准|政策|要求/.test(title)) return 'policy'
  if (/手册|指南|说明|流程|操作|预案/.test(title)) return 'playbook'
  if (/系统|架构|平台|接口|服务/.test(title)) return 'system'
  return 'concept'
}

function buildConclusions(text: string, chunks: DocumentChunkView[]): string[] {
  const blocks = buildKnowledgeBlocks(text)
  const fallback = chunks
    .flatMap(chunk => buildKnowledgeBlocks(chunk.content))
    .filter(Boolean)
  return (blocks.length > 0 ? blocks : fallback).slice(0, 8)
}

/** 将已解析资料转成可阅读、可检索并与源文档关联的动态 Wiki 页。 */
export class DynamicWikiPublisher {
  constructor(private readonly knowledgeRepo: SqliteKnowledgeRepository) {}

  publish(
    document: DocumentRecord,
    text: string,
    chunks: DocumentChunkView[],
    publishedAt = new Date().toISOString(),
  ): ManifestPage {
    const slug = `document-${document.id.replace(/^doc-/, '')}`
    const related = this.knowledgeRepo
      .loadManifest()
      .pages.filter(page => page.slug !== slug && page.topic === document.topic)
      .slice(0, 4)
      .map(page => ({ slug: page.slug, title: page.title, type: page.type }))
    const conclusions = buildConclusions(text, chunks)
    const first = conclusions[0] ?? truncate(text, 520)
    const page: ManifestPage = {
      slug,
      title: document.title,
      type: inferPageType(document.title),
      topic: document.topic,
      summary: truncate(first, 150),
      updated: document.updatedAt,
      sources: [`documents/${document.id}`],
      conclusion: conclusions,
      sourceEvidence: [
        {
          source: `documents/${document.id}`,
          title: document.originalName,
          topic: document.topic,
          department: document.source,
          points: conclusions.slice(0, 6),
        },
      ],
      links: related,
      sourceDocumentId: document.id,
      publishedAt,
      isDynamic: true,
      pipelineVersion: PIPELINE_VERSION,
    }
    this.knowledgeRepo.upsertDynamicPage(document.id, page, publishedAt)
    return page
  }

  links(documentId: string) {
    return this.knowledgeRepo.getDynamicLinksByDocument(documentId)
  }

  isCurrent(documentId: string): boolean {
    return this.knowledgeRepo.getDynamicPipelineVersion(documentId) === PIPELINE_VERSION
  }

  remove(documentId: string): string[] {
    return this.knowledgeRepo.removeDynamicByDocument(documentId)
  }
}
