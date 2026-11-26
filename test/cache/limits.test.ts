import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  flushCache,
  getCacheDir,
  getLatestData,
  getVersionData,
  setLatestData,
  setVersionData
} from '../../src/cache/index.ts'

const CACHE_MODULE = new URL('../../src/cache/index.ts', import.meta.url).href

// Each test file runs in its own process, so the stores first open from these files.
const root = mkdtempSync(join(tmpdir(), 'semver-ranger-limits-'))
process.env.XDG_CACHE_HOME = root
mkdirSync(getCacheDir(), { recursive: true })

const versionsFile = join(getCacheDir(), 'versions.json')
const latestFile = join(getCacheDir(), 'latest.json')
const DAY_MS = 24 * 60 * 60 * 1000

// Objects, so getVersionData's own shape check cannot hide a missing root check.
writeFileSync(versionsFile, '[{}, {}]')
writeFileSync(
  latestFile,
  JSON.stringify({
    'null-entry': null,
    'no-timestamp': { data: { version: '1.0.0' } },
    'no-data': { cachedAt: Date.now() },
    'string-engines': { data: { version: '1.0.0', engines: 'node >= 4' }, cachedAt: Date.now() }
  })
)

describe('cache files with the wrong shape', () => {
  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('treats malformed latest entries as missing', () => {
    assert.strictEqual(getLatestData('null-entry'), null)
    assert.strictEqual(getLatestData('no-timestamp'), null)
    assert.strictEqual(getLatestData('no-data'), null)
    // Regression: latest entries had no field shape check, so a string was served as engines.
    assert.strictEqual(getLatestData('string-engines'), null)
  })

  it('ignores a store whose root is not an object', () => {
    assert.strictEqual(getVersionData('0'), null)
  })

  // Regression: a corrupt entry counted as found, so online it was never refetched
  // and offline the package's "no metadata" warning disappeared. A non-string value
  // inside an object is not corruption: rejecting the object for it dropped valid
  // siblings, so warm runs reported a wider range than the run that fetched it.
  it('treats malformed version entries as missing and keeps objects whole', () => {
    // This file's versions store is already open, so a fresh process reads these.
    const home = mkdtempSync(join(root, 'fresh-'))
    mkdirSync(join(home, 'semver-ranger'))
    const entries = {
      'garbage@1.0.0': 'garbage',
      'string-engines@1.0.0': { engines: 'node >= 99' },
      'numeric-range@1.0.0': { peerDependencies: { react: 18 } },
      'mixed-engines@1.0.0': { engines: { node: '>=14', npm: 7 } },
      'valid@1.0.0': { engines: { node: '>=20' } }
    }
    writeFileSync(join(home, 'semver-ranger', 'versions.json'), JSON.stringify(entries))
    const script = `import { getVersionData } from ${JSON.stringify(CACHE_MODULE)}
      const keys = ${JSON.stringify(Object.keys(entries))}
      console.log(JSON.stringify(keys.map(key => getVersionData(key))))`
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: home } }
    )
    assert.strictEqual(status, 0, stderr)
    assert.deepStrictEqual(JSON.parse(stdout), [
      null,
      null,
      { peerDependencies: { react: 18 } },
      { engines: { node: '>=14', npm: 7 } },
      { engines: { node: '>=20' } }
    ])
  })

  // Old releases declare engines as a string or an array. Stored as-is, the entry
  // was rejected on read and refetched on every run.
  it('stores only fields that are objects, and returns what it stored', () => {
    const legacy = { engines: ['node >= 0.4'], peerDependencies: { a: '^1' } }
    const stored = setVersionData('legacy@1.0.0', legacy as never)
    assert.deepStrictEqual(stored, { peerDependencies: { a: '^1' } })
    assert.deepStrictEqual(getVersionData('legacy@1.0.0'), stored)
  })

  // Regression: one non-string value made the cache drop the whole object.
  it('round-trips an engines object holding a non-string value', () => {
    const mixed = { engines: { node: '>=14', npm: 7 } }
    assert.deepStrictEqual(setVersionData('mixed@1.0.0', mixed as never), mixed)
    assert.deepStrictEqual(getVersionData('mixed@1.0.0'), mixed)
  })

  it('stores only latest fields that are objects, and returns what it stored', () => {
    const stored = setLatestData('legacy-latest', {
      version: '2.0.0',
      engines: 'node >= 0.4' as never,
      peerDependencies: { a: '^1' }
    })
    assert.deepStrictEqual(stored, { version: '2.0.0', peerDependencies: { a: '^1' } })
    assert.deepStrictEqual(getLatestData('legacy-latest'), stored)
  })

  it('drops expired and malformed entries, and caps versions, when writing', t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() - 2 * DAY_MS })
    setLatestData('old', { version: '1.0.0' })
    t.mock.timers.reset()
    setLatestData('fresh', { version: '2.0.0' })
    for (let i = 0; i <= 50_000; i += 1) setVersionData(`pkg-${i}@1.0.0`, {})

    assert.strictEqual(flushCache(), null)

    const latest = JSON.parse(readFileSync(latestFile, 'utf8')) as Record<string, unknown>
    // The seeded malformed entries and 'old' go; 'legacy-latest', stored fresh by
    // an earlier test in this file, stays.
    assert.deepStrictEqual(Object.keys(latest), ['legacy-latest', 'fresh'])
    const versions = Object.keys(JSON.parse(readFileSync(versionsFile, 'utf8')) as object)
    assert.strictEqual(versions.length, 50_000)
    assert.ok(!versions.includes('pkg-0@1.0.0'), 'the oldest entry should be evicted first')
  })

  it('leaves no temporary files behind', () => {
    setVersionData('temporary@1.0.0', {})
    assert.strictEqual(flushCache(), null)
    const leftovers = readdirSync(getCacheDir()).filter(file => file.endsWith('.tmp'))
    assert.deepStrictEqual(leftovers, [])
  })

  // Writing straight into the file would show a reader, or leave a killed run
  // with, half a file. Only a rename gives the path a new inode.
  it('replaces the file rather than writing into it', () => {
    const before = statSync(versionsFile).ino
    setVersionData('inode@1.0.0', {})
    assert.strictEqual(flushCache(), null)
    assert.notStrictEqual(statSync(versionsFile).ino, before)
  })

  // Regression: a failed rename left `<store>.<pid>.tmp` behind, one more per run.
  it('removes its temporary files and returns the first failure', () => {
    // A non-empty directory in each store's place makes both renames fail.
    for (const file of [versionsFile, latestFile]) {
      rmSync(file, { force: true })
      mkdirSync(join(file, 'blocker'), { recursive: true })
    }
    setVersionData('blocked@1.0.0', {})
    setLatestData('blocked', { version: '1.0.0' })
    try {
      const message = String(flushCache()?.message)
      assert.match(message, /versions\.json/u, 'the versions store is written first')
      assert.doesNotMatch(message, /latest\.json/u)
      const leftovers = readdirSync(getCacheDir()).filter(file => file.endsWith('.tmp'))
      assert.deepStrictEqual(leftovers, [])
    } finally {
      for (const file of [versionsFile, latestFile]) rmSync(file, { recursive: true, force: true })
    }
  })

  it('does not rewrite a store when nothing has changed since the last flush', () => {
    setLatestData('unchanged', { version: '1.0.0' })
    assert.strictEqual(flushCache(), null)
    rmSync(latestFile)
    assert.strictEqual(flushCache(), null)
    assert.throws(() => readFileSync(latestFile), /ENOENT/u)
  })
})

describe('getCacheDir environment handling', () => {
  for (const value of ['', 'relative/path']) {
    it(`ignores XDG_CACHE_HOME=${JSON.stringify(value)}`, () => {
      const original = process.env.XDG_CACHE_HOME
      process.env.XDG_CACHE_HOME = value
      try {
        assert.ok(getCacheDir().startsWith('/') || /^[A-Za-z]:/u.test(getCacheDir()))
        assert.ok(!getCacheDir().startsWith(value === '' ? 'semver-ranger' : 'relative'))
      } finally {
        process.env.XDG_CACHE_HOME = original
      }
    })
  }
})
