import { compileWiki } from './compiler.js'

/**
 * `pnpm wiki:compile` CLI 入口。
 * 运行确定性编译，把 raw/ 的 18 份源资料重组为 wiki/ 的 47 个知识页。
 */
const manifest = compileWiki()

console.log('编译完成 ✔')
console.log(`- 源资料：${manifest.sources.length} 份（raw/ 零改动、零新增）`)
console.log(`- 知识页：${manifest.stats.pages} 个`)
console.log(
  `- 类型分布：${manifest.types
    .map(t => `${t.type} ${t.count}`)
    .join(' · ')}`,
)
console.log(
  `- 互链：${manifest.stats.interlinks} · 来源引用：${manifest.stats.sourceCitations} · 覆盖主题：${manifest.stats.topicsCovered}`,
)
console.log(`- 编译时间：${manifest.stats.lastCompiledAt}`)
console.log('- 产物目录：content/wiki/')
