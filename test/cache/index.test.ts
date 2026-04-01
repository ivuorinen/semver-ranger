import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { describe, it, before, after } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getVersionData,
  setVersionData,
  getLatestData,
  setLatestData,
  getCacheDir
} from '../../src/cache/index.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const tmpCacheDir = join(currentDir, '../../.tmp-cache-test')

// Override XDG_CACHE_HOME before importing cache module
process.env.XDG_CACHE_HOME = tmpCacheDir

describe('cache', () => {
  before(() => {
    // clean state
    try {
      rmSync(join(tmpCacheDir, 'semver-ranger'), { recursive: true, force: true })
    } catch {
      /**/
    }
  })

  after(() => {
    try {
      rmSync(tmpCacheDir, { recursive: true, force: true })
    } catch {
      /**/
    }
  })

  it('version cache: miss returns null', () => {
    const result = getVersionData('nonexistent@1.0.0')
    assert.strictEqual(result, null)
  })

  it('version cache: set then get returns data', () => {
    const data = { engines: { node: '>=18' }, peerDependencies: {} }
    setVersionData('express@4.18.2', data)
    const result = getVersionData('express@4.18.2')
    assert.deepStrictEqual(result, data)
  })

  it('latest cache: miss returns null', () => {
    const result = getLatestData('nonexistent')
    assert.strictEqual(result, null)
  })

  it('latest cache: set then get returns data', () => {
    const data = { version: '5.0.0', engines: { node: '>=18' }, peerDependencies: {} }
    setLatestData('express', data)
    const result = getLatestData('express')
    assert.deepStrictEqual(result, data)
  })

  it('uses XDG_CACHE_HOME when set', () => {
    const prev = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = '/tmp/test-xdg-semver'
    try {
      const dir = getCacheDir()
      assert.ok(dir.startsWith('/tmp/test-xdg-semver'))
      assert.ok(dir.includes('semver-ranger'))
    } finally {
      if (typeof prev === 'undefined') delete process.env.XDG_CACHE_HOME
      else process.env.XDG_CACHE_HOME = prev
    }
  })

  it('uses envPaths when XDG_CACHE_HOME is not set', () => {
    const prev = process.env.XDG_CACHE_HOME
    delete process.env.XDG_CACHE_HOME
    try {
      const dir = getCacheDir()
      assert.ok(dir.includes('semver-ranger'))
    } finally {
      if (typeof prev !== 'undefined') process.env.XDG_CACHE_HOME = prev
    }
  })

  it('latest cache: expired entry returns null', () => {
    const data = { version: '4.0.0', engines: {}, peerDependencies: {} }
    // Manually set with old cachedAt
    const oldEntry = { data, cachedAt: Date.now() - 25 * 60 * 60 * 1000 } // 25 hours ago
    setLatestData('old-pkg', data, oldEntry.cachedAt)
    const result = getLatestData('old-pkg')
    assert.strictEqual(result, null)
  })
})
