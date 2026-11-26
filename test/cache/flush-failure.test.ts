import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { flushCache, getVersionData, setLatestData, setVersionData } from '../../src/cache/index.ts'

// A file where the cache directory should go makes both reading and writing fail.
// This has its own file because the stores keep the location they first opened with.
const root = mkdtempSync(join(tmpdir(), 'semver-ranger-flush-failure-'))
const notADirectory = join(root, 'not-a-directory')
writeFileSync(notADirectory, '')
process.env.XDG_CACHE_HOME = notADirectory

describe('cache with an unusable directory', () => {
  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads as empty rather than failing the run', () => {
    assert.strictEqual(getVersionData('a@1.0.0'), null)
  })

  it('returns the failed write instead of throwing', () => {
    setVersionData('a@1.0.0', {})
    setLatestData('a', { version: '1.0.0' })
    assert.ok(flushCache() instanceof Error)
  })
})
