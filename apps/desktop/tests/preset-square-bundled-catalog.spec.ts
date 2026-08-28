import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { ResourcePresetSquareCatalog } from '../src/preset-square/bundled-catalog.ts'

const resources = fileURLToPath(new URL('../resources/preset-square/presets/', import.meta.url))

describe('bundled Preset Square catalog', () => {
  it('materializes seven compact first-party archives with nine Skills and no install-machine placeholders', async () => {
    const catalog = new ResourcePresetSquareCatalog(resources)
    const items = await catalog.list()
    expect(items).toHaveLength(7)
    expect(items.map(item => item.source)).toEqual(Array(7).fill('fufan-official'))
    expect(items.map(item => item.publisher.username)).toEqual(Array(7).fill('赋范官方'))
    expect(items.map(item => item.artifact.sourceDshVersion)).toEqual(Array(7).fill('0.1.0-rc.8'))
    expect(items.at(0)).toMatchObject({
      slug: 'fufan-llm-wiki-producer',
      presetId: 'llm-wiki-fullstack',
      title: 'LLM Wiki Producer',
    })

    let archiveBytes = 0
    let skills = 0
    for (const item of items) {
      const archive = await catalog.archive(item.slug)
      expect(archive).toBeDefined()
      if (archive === undefined) continue
      archiveBytes += archive.length
      expect(createHash('sha256').update(archive).digest('hex')).toBe(item.artifact.sha256)
      const files = unzipSync(archive)
      expect(files['manifest.json']).toBeDefined()
      expect(strFromU8(files['manifest.json'] ?? new Uint8Array()))
        .toContain('"sourceDshVersion": "0.1.0-rc.8"')
      expect(files['preset/agent.cordis.yml']).toBeDefined()
      const composition = strFromU8(files['preset/agent.cordis.yml'] ?? new Uint8Array())
      expect(composition).not.toContain('__CASE_')
      expect(composition).not.toContain('__FEISHU_')
      if (item.slug === 'fufan-feishu-digital-employee') {
        expect(composition).toContain('credentialEnv:')
        expect(composition).toContain('FEISHU_DEFAULT_OPEN_ID: FEISHU_DEFAULT_OPEN_ID')
        const server = strFromU8(files['preset/runtime/feishu-mcp.mjs'] ?? new Uint8Array())
        expect(server).toContain("role: 'assignee'")
      }
      if (item.slug === 'fufan-video-generation') {
        const skill = strFromU8(files['preset/skills/product-launch-video/SKILL.md'] ?? new Uint8Array())
        expect(skill).toContain('hyperframes init')
        expect(skill).not.toContain('npx --yes hyperframes')
      }
      if (item.slug === 'fufan-content-factory') {
        expect(composition).toContain('name: ./runtime/content-imagegen/index.js')
        expect(composition).not.toContain('dsh-content-imagen')
        const runtime = strFromU8(files['preset/runtime/content-imagegen/index.js'] ?? new Uint8Array())
        expect(runtime).toContain('exec.agent?.session.header.cwd')
        expect(runtime).not.toContain('config.caseRoot')
      }
      if (item.slug === 'fufan-llm-wiki-producer') {
        expect(composition).toContain('你是「LLM Wiki 全栈工程师」')
        expect(composition).toContain('backgroundMode: one-shot')
        expect(files['preset/skills/find-plugins/SKILL.md']).toBeDefined()
      }
      skills += Object.keys(files).filter(path => /^preset\/skills\/[^/]+\/SKILL\.md$/u.test(path)).length
    }
    expect(skills).toBe(9)
    expect(archiveBytes).toBeLessThan(2 * 1024 * 1024)
  })
})
