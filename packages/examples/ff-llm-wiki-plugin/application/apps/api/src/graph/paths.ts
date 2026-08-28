import { join } from 'node:path'
import { REPO_ROOT } from '../wiki/paths.js'

/**
 * 图谱产物目录（output/），与 content/ 平级放在仓库根。
 * 这里的三个文件是可再生产物：每次 `pnpm graph:extract` 都会重新生成，
 * 不承载任何手写事实（与 content/raw/ 源层不可变形成对照）。
 */
export const OUTPUT_DIR = join(REPO_ROOT, 'output')
export const KG_NODES_PATH = join(OUTPUT_DIR, 'kg_nodes.json')
export const KG_EDGES_PATH = join(OUTPUT_DIR, 'kg_edges.json')
export const KG_META_PATH = join(OUTPUT_DIR, 'kg_meta.json')
