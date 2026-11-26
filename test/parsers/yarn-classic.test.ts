import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnClassicLockfile } from '../../src/parsers/yarn-classic.ts'

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
    assert.throws(
      () => parseYarnClassicLockfile('<<<conflict\nbad content\n>>>'),
      /invalid line 1/u
    )
  })

  it('throws on merge conflict markers instead of dropping packages', () => {
    const content = [
      '# yarn lockfile v1',
      '',
      'foo@^1.0.0:',
      '<<<<<<< HEAD',
      '  version "1.0.0"',
      '=======',
      '  version "1.0.1"',
      '>>>>>>> other'
    ].join('\n')
    assert.throws(() => parseYarnClassicLockfile(content), /invalid line 4/u)
  })

  it('collapses an alias onto its real package in a merged header', () => {
    const content = '"@a/b@^1.0.0", "alias@npm:@a/b@^1.0.0", plain@^1:\n  version "1.2.3"\n'
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [
      { name: '@a/b', version: '1.2.3' },
      { name: 'plain', version: '1.2.3' }
    ])
  })

  it('does not mistake a dependency named "version" for the entry version', () => {
    const content = [
      'host@^1.0.0:',
      '  version "1.0.0"',
      '  dependencies:',
      '    version "9.9.9"'
    ].join('\n')
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [{ name: 'host', version: '1.0.0' }])
  })

  it('handles CRLF line endings and a byte order mark', () => {
    const content = '\ufeff# yarn lockfile v1\r\n\r\nfoo@^1:\r\n  version "1.0.0"\r\n'
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [{ name: 'foo', version: '1.0.0' }])
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
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [])
  })

  it('ignores a version line that belongs to no entry', () => {
    assert.deepStrictEqual(parseYarnClassicLockfile('  version "1.0.0"\n'), [])
  })

  it('accepts an unquoted version', () => {
    assert.deepStrictEqual(parseYarnClassicLockfile('foo@^1:\n  version 1.2.3\n'), [
      { name: 'foo', version: '1.2.3' }
    ])
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

describe('parseYarnClassicLockfile aliases', () => {
  it('uses the real name and keeps the install directory for an alias', () => {
    const content = '"string-width-cjs@npm:string-width@^4.2.0":\n  version "4.2.3"\n'
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [
      { name: 'string-width', version: '4.2.3', alias: 'string-width-cjs' }
    ])
  })

  it('resolves an alias when both names are scoped', () => {
    const content = '"@my/nick@npm:@real/pkg@^1.0.0":\n  version "1.0.0"\n'
    assert.deepStrictEqual(parseYarnClassicLockfile(content), [
      { name: '@real/pkg', version: '1.0.0', alias: '@my/nick' }
    ])
  })

  it('does not mistake an npm: range for an alias', () => {
    assert.deepStrictEqual(parseYarnClassicLockfile('foo@npm:^1.0.0:\n  version "1.2.3"\n'), [
      { name: 'foo', version: '1.2.3' }
    ])
  })
})

describe('parseYarnClassicLockfile sources', () => {
  const entry = (specifier: string): string => `"${specifier}":\n  version "1.0.0"\n`

  for (const range of [
    'github:me/foo',
    'me/foo',
    'file:./foo',
    'https://example.test/foo.tgz',
    'git+ssh://git@github.com/me/foo.git'
  ]) {
    it(`marks a package from ${range} as unpublished`, () => {
      assert.deepStrictEqual(parseYarnClassicLockfile(entry(`foo@${range}`)), [
        { name: 'foo', version: '1.0.0', unpublished: true }
      ])
    })
  }

  for (const range of ['^1.0.0 || ^2.0.0', 'latest', 'npm:^1.0.0']) {
    it(`treats ${range} as a registry range`, () => {
      assert.deepStrictEqual(parseYarnClassicLockfile(entry(`foo@${range}`)), [
        { name: 'foo', version: '1.0.0' }
      ])
    })
  }

  it('treats an alias as a registry range', () => {
    assert.deepStrictEqual(parseYarnClassicLockfile(entry('nick@npm:@s/real@^1')), [
      { name: '@s/real', version: '1.0.0', alias: 'nick' }
    ])
  })
})
