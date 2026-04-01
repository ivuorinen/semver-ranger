import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnClassicLockfile } from '../../src/parsers/yarn-classic.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('parseYarnClassicLockfile', () => {
  it('parses yarn classic lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf8')
    const packages = parseYarnClassicLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('parses package entry that contains a dependencies block', () => {
    const content = [
      '# yarn lockfile v1',
      '',
      'pkg-with-deps@^1.0.0:',
      '  version "1.2.3"',
      '  resolved "https://registry.npmjs.org/pkg-with-deps/-/pkg-with-deps-1.2.3.tgz"',
      '  dependencies:',
      '    lodash "^4.0.0"'
    ].join('\n')
    const packages = parseYarnClassicLockfile(content)
    const pkg = packages.find(p => p.name === 'pkg-with-deps')
    assert.ok(pkg)
    assert.strictEqual(pkg.version, '1.2.3')
  })

  it('throws on malformed lockfile', () => {
    // @yarnpkg/lockfile itself throws a SyntaxError on truly invalid content
    assert.throws(() => parseYarnClassicLockfile('<<<conflict\nbad content\n>>>'))
  })

  it('skips entries with unparseable keys', () => {
    // A key with no "@" separator is skipped by the nameMatch guard
    const content = [
      '# yarn lockfile v1',
      '',
      'no-at-sign-key:',
      '  version "1.0.0"',
      '  resolved "https://registry.npmjs.org/no-at-sign-key/-/no-at-sign-key-1.0.0.tgz"'
    ].join('\n')
    const packages = parseYarnClassicLockfile(content)
    assert.ok(!packages.some(p => p.name === 'no-at-sign-key'))
  })

  it('includes typescript', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf8')
    const packages = parseYarnClassicLockfile(content)
    const ts = packages.find(p => p.name === 'typescript')
    assert.ok(ts)
    assert.strictEqual(ts.version, '5.0.4')
  })

  it('deduplicates packages with same name and version', () => {
    const content = [
      '# yarn lockfile v1',
      '',
      'express@^4.18.0:',
      '  version "4.18.2"',
      '  resolved "https://registry.npmjs.org/express/-/express-4.18.2.tgz"',
      '',
      'express@^4.18.1:',
      '  version "4.18.2"',
      '  resolved "https://registry.npmjs.org/express/-/express-4.18.2.tgz"'
    ].join('\n')
    const packages = parseYarnClassicLockfile(content)
    const expressEntries = packages.filter(p => p.name === 'express')
    assert.strictEqual(expressEntries.length, 1)
  })
})
