import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { describe, it, after } from 'node:test'
import { join } from 'node:path'

import {
  getVersionData,
  setVersionData,
  getLatestData,
  setLatestData,
  getCacheDir
} from '../../src/cache/index.ts'

const CACHE_MODULE = new URL('../../src/cache/index.ts', import.meta.url).href
const tmpCacheDir = mkdtempSync(join(tmpdir(), 'semver-ranger-cache-'))

// The stores open on first use, so this only has to run before the first cache call.
process.env.XDG_CACHE_HOME = tmpCacheDir

after(() => {
  rmSync(tmpCacheDir, { recursive: true, force: true })
})

describe('cache', () => {
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
      assert.strictEqual(dir, join('/tmp/test-xdg-semver', 'semver-ranger'))
    } finally {
      if (typeof prev === 'undefined') delete process.env.XDG_CACHE_HOME
      else process.env.XDG_CACHE_HOME = prev
    }
  })

  it('follows each platform convention when XDG_CACHE_HOME is not set', () => {
    const prevXdg = process.env.XDG_CACHE_HOME
    const prevLocalAppData = process.env.LOCALAPPDATA
    const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
    const home = homedir()
    const dirOn = (value: NodeJS.Platform): string => {
      Object.defineProperty(process, 'platform', { value })
      return getCacheDir()
    }
    delete process.env.XDG_CACHE_HOME
    delete process.env.LOCALAPPDATA
    try {
      assert.strictEqual(dirOn('linux'), join(home, '.cache', 'semver-ranger'))
      assert.strictEqual(dirOn('darwin'), join(home, 'Library', 'Caches', 'semver-ranger'))
      assert.strictEqual(dirOn('win32'), join(home, 'AppData', 'Local', 'semver-ranger', 'Cache'))
      process.env.LOCALAPPDATA = join(home, 'custom')
      assert.strictEqual(dirOn('win32'), join(home, 'custom', 'semver-ranger', 'Cache'))
    } finally {
      Object.defineProperty(process, 'platform', platform)
      if (typeof prevXdg !== 'undefined') process.env.XDG_CACHE_HOME = prevXdg
      if (typeof prevLocalAppData === 'undefined') delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = prevLocalAppData
    }
  })

  it('latest cache: expired entry returns null', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 })
    setLatestData('old-pkg', { version: '4.0.0', engines: {}, peerDependencies: {} })
    t.mock.timers.tick(25 * 60 * 60 * 1000)
    assert.strictEqual(getLatestData('old-pkg'), null)
  })
})

describe('latest cache lifetime', () => {
  it('still serves an entry that is exactly 24 hours old', t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 })
    const data = { version: '4.0.0', engines: {}, peerDependencies: {} }
    setLatestData('boundary-pkg', data)
    t.mock.timers.tick(24 * 60 * 60 * 1000)
    assert.deepStrictEqual(getLatestData('boundary-pkg'), data)
  })
})

describe('flushCache', () => {
  // Regression: save() ran on every setKey, serializing the whole store each
  // time — O(n^2) bytes written per run. Writes are now deferred to one flush.
  // Distinct keys per store: a shared prefix would let this pass with either
  // store's save() removed.
  it('persists deferred writes from both stores to disk', async () => {
    const { flushCache } = await import('../../src/cache/index.ts')
    setVersionData('flush-version@1.0.0', { engines: { node: '>=18' } })
    setLatestData('flush-latest', { version: '2.0.0', engines: { node: '>=20' } })
    assert.throws(() => readdirSync(getCacheDir()), /ENOENT/u, 'written before the flush')
    assert.strictEqual(flushCache(), null)

    const files = readdirSync(getCacheDir())
    assert.ok(files.length > 0, 'expected cache files on disk after flush')
    const written = files.map(f => readFileSync(join(getCacheDir(), f), 'utf8')).join('\n')
    assert.ok(written.includes('flush-version'), 'versions store was not written')
    assert.ok(written.includes('flush-latest'), 'latest store was not written')
  })

  // The stores above are open by now, so only a fresh process reaches flushCache
  // with neither store loaded, as a run that never looked anything up does.
  it('is safe to call before any store was opened', () => {
    const home = mkdtempSync(join(tmpdir(), 'semver-ranger-unopened-'))
    const script = `import { flushCache } from ${JSON.stringify(CACHE_MODULE)}
      console.log(JSON.stringify(flushCache()))`
    try {
      const { status, stdout, stderr } = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        { encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: home } }
      )
      assert.strictEqual(status, 0, stderr)
      assert.strictEqual(stdout.trim(), 'null')
      assert.deepStrictEqual(readdirSync(home), [], 'nothing should be written')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not resolve package names through Object.prototype', () => {
    assert.strictEqual(getVersionData('constructor'), null)
    assert.strictEqual(getVersionData('__proto__'), null)
    assert.strictEqual(getLatestData('constructor'), null)
  })
})
