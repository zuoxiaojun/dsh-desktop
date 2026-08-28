import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { findRepoRoot } from '../src/wiki/paths.js'

test('桌面运行时根目录优先于源码仓库探测', () => {
  const previous = process.env.LLMWIKI_RUNTIME_ROOT
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'llmwiki-runtime-root-'))
  process.env.LLMWIKI_RUNTIME_ROOT = runtimeRoot
  try {
    assert.equal(findRepoRoot('/path/without/a/workspace'), resolve(runtimeRoot))
  } finally {
    if (previous === undefined) delete process.env.LLMWIKI_RUNTIME_ROOT
    else process.env.LLMWIKI_RUNTIME_ROOT = previous
  }
})
