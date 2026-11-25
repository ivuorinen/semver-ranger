import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// Each test file runs in its own process, so the stores open for the first time
// from the files seeded here, the way they do at the start of a real run.
const root = mkdtempSync(join(tmpdir(), 'semver-ranger-persistence-'))
process.env.XDG_CACHE_HOME = root
mkdirSync(getCacheDir(), { recursive: true })

const versionsFile = join(getCacheDir(), 'versions.json')
const latestFile = join(getCacheDir(), 'latest.json')
const cachedAt = Date.now()
writeFileSync(versionsFile, '{not json')
writeFileSync(
  latestFile,
  `{
    "express": { "data": { "version": "5.0.0" }, "cachedAt": ${cachedAt} },
    "__proto__": { "data": { "version": "1.0.0" }, "cachedAt": ${cachedAt} }
  }`
)

describe('cache persistence across runs', () => {
  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('loads entries written by an earlier run', () => {
    assert.deepStrictEqual(getLatestData('express'), { version: '5.0.0' })
  })

  it('treats a corrupt file as empty', () => {
    assert.strictEqual(getVersionData('a@1.0.0'), null)
  })

  it('leaves a store nothing changed on disk as it was', () => {
    assert.strictEqual(getVersionData('opens-the-store@1.0.0'), null)
    assert.strictEqual(flushCache(), null)
    assert.strictEqual(readFileSync(versionsFile, 'utf8'), '{not json')
  })

  it('replaces a corrupt file once there is something to write', () => {
    setVersionData('a@1.0.0', { engines: { node: '>=20' } })
    assert.strictEqual(flushCache(), null)
    assert.deepStrictEqual(JSON.parse(readFileSync(versionsFile, 'utf8')), {
      'a@1.0.0': { engines: { node: '>=20' } }
    })
  })

  it('keeps a package named __proto__ as ordinary data through a round trip', () => {
    assert.deepStrictEqual(getLatestData('__proto__'), { version: '1.0.0' })
    assert.ok(!('data' in {}), 'Object.prototype was polluted')

    setLatestData('other', { version: '2.0.0' })
    assert.strictEqual(flushCache(), null)
    const names = Object.keys(JSON.parse(readFileSync(latestFile, 'utf8')) as object)
    assert.deepStrictEqual(names.toSorted(), ['__proto__', 'express', 'other'])
  })
})
