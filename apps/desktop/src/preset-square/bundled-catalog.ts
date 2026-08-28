/** Read-only catalog and deterministic archives shipped with the Desktop app. */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import {
  decodePresetSquareItem,
  type PresetSquareItem,
} from '@deepseek-ai/dsh-plugin-center-contracts'
import { zipSync, type Zippable } from 'fflate'

const ARCHIVE_MTIME = new Date('2026-08-17T00:00:00.000Z')
const PUBLISHER = '赋范官方'
const SOURCE_DSH_VERSION = '0.1.0-rc.8'

interface BundledPresetDefinition {
  readonly id: string
  readonly slug: string
  readonly presetId: string
  readonly title: string
  readonly description: string
  readonly visualVariant: number
  readonly createdAt: string
}

const DEFINITIONS = [{
  id: 'fufan-case-07-llm-wiki-producer',
  slug: 'fufan-llm-wiki-producer',
  presetId: 'llm-wiki-fullstack',
  title: 'LLM Wiki Producer',
  description: '1 套 Agent Preset + 1 个 Skill，面向企业知识库项目按阶段完成开发、验证与交付。',
  visualVariant: 6,
  createdAt: '2026-08-17T06:07:00.000Z',
}, {
  id: 'fufan-case-01-ai-webapp',
  slug: 'fufan-ai-webapp',
  presetId: 'ai-product-developer',
  title: 'AI WebApp',
  description: '1 套 Agent Preset + 3 个 Skills，覆盖需求澄清、规格整理与 TDD 的 Web 产品开发流程。',
  visualVariant: 0,
  createdAt: '2026-08-17T06:01:00.000Z',
}, {
  id: 'fufan-case-02-ppt-office',
  slug: 'fufan-ppt-office',
  presetId: 'dsh-motion-deck-studio',
  title: 'PPT Office',
  description: '1 套 Agent Preset + 1 个 Skill，把大纲生成并验收为 8 页可交互动效演示。',
  visualVariant: 1,
  createdAt: '2026-08-17T06:02:00.000Z',
}, {
  id: 'fufan-case-03-video-generation',
  slug: 'fufan-video-generation',
  presetId: 'product-video-director',
  title: '视频生成',
  description: '1 套 Agent Preset + 1 个 Skill，从调研、分镜到 HyperFrames MP4；运行需 FFmpeg。',
  visualVariant: 2,
  createdAt: '2026-08-17T06:03:00.000Z',
}, {
  id: 'fufan-case-04-content-factory',
  slug: 'fufan-content-factory',
  presetId: 'ai-content-image-studio',
  title: '内容工厂',
  description: '1 套 Agent Preset + 1 个 Skill + 1 个图像生成 Plugin；生图需本机已登录 Codex CLI。',
  visualVariant: 3,
  createdAt: '2026-08-17T06:04:00.000Z',
}, {
  id: 'fufan-case-05-ai-report',
  slug: 'fufan-ai-report',
  presetId: 'ai-report-analyst',
  title: 'AI 报表',
  description: '1 套 Agent Preset + 1 个 Skill，把本地 Excel 生成可验收的离线交互报告。',
  visualVariant: 4,
  createdAt: '2026-08-17T06:05:00.000Z',
}, {
  id: 'fufan-case-06-feishu-digital-employee',
  slug: 'fufan-feishu-digital-employee',
  presetId: 'feishu-digital-employee',
  title: '飞书数字员工',
  description: '1 套 Agent Preset + 1 个 Skill，并接入飞书 MCP 与时间解析 MCP；使用前需配置飞书应用凭证。',
  visualVariant: 5,
  createdAt: '2026-08-17T06:06:00.000Z',
}] as const satisfies readonly BundledPresetDefinition[]

interface MaterializedPreset {
  readonly item: PresetSquareItem
  readonly archive: Uint8Array
}

/** Read-only catalog face consumed by the fixed-origin Desktop client. */
export interface PresetSquareBundledCatalog {
  /** @returns All bundled entries in product order. */
  list(): Promise<readonly PresetSquareItem[]>
  /** @param slug - Stable bundled catalog slug. @returns The matching entry, if shipped. */
  detail(slug: string): Promise<PresetSquareItem | undefined>
  /** @param slug - Stable bundled catalog slug. @returns Its deterministic `.dshpreset` bytes, if shipped. */
  archive(slug: string): Promise<Uint8Array | undefined>
}

async function readTree(root: string, directory = root): Promise<Zippable> {
  const files: Zippable = {}
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Bundled Preset contains a symbolic link: ${entry.name}`)
    if (entry.isDirectory()) {
      Object.assign(files, await readTree(root, path))
      continue
    }
    if (!entry.isFile()) throw new Error(`Bundled Preset contains an unsupported entry: ${entry.name}`)
    files[relative(root, path).split(sep).join('/')] = await readFile(path)
  }
  return files
}

/** Filesystem-backed bundled catalog used in development and packaged resources. */
export class ResourcePresetSquareCatalog implements PresetSquareBundledCatalog {
  private materialized?: Promise<readonly MaterializedPreset[]>

  /** @param root - Directory containing one resource tree per bundled slug. */
  constructor(private readonly root: string) {}

  async list(): Promise<readonly PresetSquareItem[]> {
    return (await this.load()).map(entry => entry.item)
  }

  async detail(slug: string): Promise<PresetSquareItem | undefined> {
    return (await this.load()).find(entry => entry.item.slug === slug)?.item
  }

  async archive(slug: string): Promise<Uint8Array | undefined> {
    return (await this.load()).find(entry => entry.item.slug === slug)?.archive
  }

  private load(): Promise<readonly MaterializedPreset[]> {
    this.materialized ??= Promise.all(DEFINITIONS.map(async (definition) => {
      const source = join(this.root, definition.slug)
      const files = await readTree(source)
      if (files['manifest.json'] === undefined || files['preset/agent.cordis.yml'] === undefined) {
        throw new Error(`Bundled Preset ${definition.slug} is incomplete`)
      }
      const archive = zipSync(files, { level: 9, mtime: ARCHIVE_MTIME })
      const digest = createHash('sha256').update(archive).digest('hex')
      const downloadUrl = `https://www.dshdesktop.com/preset/api/v1/presets/${definition.slug}/download`
      return {
        archive,
        item: decodePresetSquareItem({
          ...definition,
          source: 'fufan-official',
          publisher: { username: PUBLISHER },
          artifact: {
            downloadUrl,
            sha256: digest,
            sizeBytes: archive.length,
            formatVersion: 1,
            sourceDshVersion: SOURCE_DSH_VERSION,
          },
          detailUrl: `https://www.dshdesktop.com/preset/p/${definition.slug}`,
          downloadCount: 0,
        }),
      }
    }))
    return this.materialized
  }
}

/** Empty bundled catalog used by tests that exercise only the community client. */
export const EMPTY_PRESET_SQUARE_CATALOG: PresetSquareBundledCatalog = {
  list: () => Promise.resolve([]),
  detail: () => Promise.resolve(undefined),
  archive: () => Promise.resolve(undefined),
}
