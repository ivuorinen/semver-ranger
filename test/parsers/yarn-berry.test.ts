import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnBerryLockfile } from '../../src/parsers/yarn-berry.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('parseYarnBerryLockfile', () => {
  it('parses yarn berry lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf8')
    const packages = parseYarnBerryLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('parses package with engines field without error', () => {
    const content = [
      '__metadata:',
      '  version: 6',
      '  cacheKey: 8',
      '',
      '"lodash@npm:^4.17.21":',
      '  version: 4.17.21',
      '  resolution: "lodash@npm:4.17.21"',
      '  engines:',
      '    node: ">=0.10.0"',
      '  checksum: abc123',
      '  languageName: node',
      '  linkType: hard'
    ].join('\n')
    const packages = parseYarnBerryLockfile(content)
    const lodash = packages.find(p => p.name === 'lodash')
    assert.ok(lodash)
    assert.strictEqual(lodash.version, '4.17.21')
  })

  it('skips entries without version', () => {
    const content = [
      '__metadata:',
      '  version: 6',
      '',
      '"pkg@npm:^1.0.0":',
      '  resolution: "pkg@npm:1.0.0"',
      '  languageName: node',
      '  linkType: hard',
      '',
      '"no-version-pkg@npm:^2.0.0":',
      '  languageName: node',
      '  linkType: hard'
    ].join('\n')
    const packages = parseYarnBerryLockfile(content)
    assert.ok(!packages.some(p => p.name === 'no-version-pkg'))
  })

  it('skips entries with non-standard protocol keys', () => {
    const content = [
      '__metadata:',
      '  version: 6',
      '',
      'pkg-without-protocol:',
      '  version: 1.0.0',
      '  languageName: node',
      '  linkType: hard'
    ].join('\n')
    const packages = parseYarnBerryLockfile(content)
    assert.ok(!packages.some(p => p.name === 'pkg-without-protocol'))
  })

  it('skips __metadata entry', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf8')
    const packages = parseYarnBerryLockfile(content)
    const meta = packages.find(p => p.name === '__metadata')
    assert.ok(!meta)
  })
})
