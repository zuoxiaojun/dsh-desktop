import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本模块所在目录（src 与编译后 dist 均可据此定位仓库根） */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 从任意目录向上寻找仓库根（以 pnpm-workspace.yaml 为锚点）。
 * 保证编译器在 `pnpm --filter` 的 cwd、tsx 直跑、以及 dist 产物三种形态下
 * 都能定位到同一个 content 目录。
 */
export function findRepoRoot(startDir: string): string {
  const runtimeRoot = process.env.LLMWIKI_RUNTIME_ROOT?.trim()
  if (runtimeRoot) return resolve(runtimeRoot)

  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('未找到仓库根目录（缺少 pnpm-workspace.yaml）')
    }
    dir = parent
  }
}

export const REPO_ROOT = findRepoRoot(MODULE_DIR)

/** 三层结构目录：规则层 + 源层（只读）+ 产物层。 */
export const CONTENT_ROOT = join(REPO_ROOT, 'content')
export const CLAUDE_MD_PATH = join(CONTENT_ROOT, 'CLAUDE.md')
export const RAW_DIR = join(CONTENT_ROOT, 'raw')
export const WIKI_DIR = join(CONTENT_ROOT, 'wiki')
