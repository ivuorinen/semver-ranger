import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnBerryLockfile } from '../../src/parsers/yarn-berry.ts'

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
    assert.deepStrictEqual(parseYarnBerryLockfile(content), [])
  })

  it('counts a package and its patched build once', () => {
    const content = `__metadata:
  version: 8

"typescript@npm:5.0.4":
  version: 5.0.4
  resolution: "typescript@npm:5.0.4"

"typescript@patch:typescript@npm%3A5.0.4#optional!builtin<compat/typescript>":
  version: 5.0.4
  resolution: "typescript@patch:typescript@npm%3A5.0.4#optional!builtin<compat/typescript>"
`
    assert.deepStrictEqual(
      parseYarnBerryLockfile(content).map(p => `${p.name}@${p.version}`),
      ['typescript@5.0.4']
    )
  })

  it('skips a key that is not a descriptor', () => {
    const content = [
      '__metadata:',
      '  version: 6',
      '',
      'pkg-without-protocol:',
      '  version: 1.0.0',
      '  languageName: node',
      '  linkType: hard'
    ].join('\n')
    assert.deepStrictEqual(parseYarnBerryLockfile(content), [])
  })

  it('skips __metadata entry', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf8')
    const packages = parseYarnBerryLockfile(content)
    const meta = packages.find(p => p.name === '__metadata')
    assert.ok(typeof meta === 'undefined')
  })
})

describe('parseYarnBerryLockfile entries', () => {
  const lockfile = (...entries: string[]) => ['__metadata:\n  version: 8', ...entries].join('\n\n')

  it('returns every distinct package', () => {
    const content = lockfile('"a@npm:^1":\n  version: 1.0.0', '"b@npm:^2":\n  version: 2.0.0')
    assert.deepStrictEqual(
      parseYarnBerryLockfile(content).map(p => `${p.name}@${p.version}`),
      ['a@1.0.0', 'b@2.0.0']
    )
  })

  it('does not report a workspace as a package', () => {
    const content = lockfile('"app@workspace:.":\n  version: 0.0.0-use.local')
    assert.deepStrictEqual(parseYarnBerryLockfile(content), [])
  })

  it('skips an entry whose version is empty', () => {
    assert.deepStrictEqual(parseYarnBerryLockfile(lockfile('"a@npm:^1":\n  version: ""')), [])
  })

  it('reads a lockfile that repeats a key', () => {
    const entry = '"a@npm:^1":\n  version: 1.0.0'
    assert.strictEqual(parseYarnBerryLockfile(lockfile(entry, entry)).length, 1)
  })
})

describe('parseYarnBerryLockfile peerDependencies', () => {
  // Regression: the parse result was typed as Record<string, Record<string,string>>,
  // which structurally could not carry the nested peerDependencies map.
  it('propagates peerDependencies declared in the lockfile', () => {
    const content = `__metadata:
  version: 6

"react-dom@npm:18.3.1":
  version: 18.3.1
  peerDependencies:
    react: ^18.3.1
  checksum: abc
  languageName: node
  linkType: hard
`
    const packages = parseYarnBerryLockfile(content)
    const reactDom = packages.find(p => p.name === 'react-dom')
    assert.ok(typeof reactDom !== 'undefined')
    assert.deepStrictEqual(reactDom.peerDependencies, { react: '^18.3.1' })
  })

  // Yarn leaves these unquoted, so a YAML parser's default schema would hand the
  // analyzer the number 18, which is not a semver range.
  it('keeps numeric-looking ranges as strings', () => {
    const content = `__metadata:
  version: 8

"a@npm:^1":
  version: 1.0.0
  peerDependencies:
    react: 18
    vue: 3.0
`
    const [pkg] = parseYarnBerryLockfile(content)
    assert.deepStrictEqual(pkg.peerDependencies, { react: '18', vue: '3.0' })
  })
})

describe('parseYarnBerryLockfile document shape', () => {
  it('reads an empty lockfile as no packages', () => {
    assert.deepStrictEqual(parseYarnBerryLockfile(''), [])
  })

  it('throws when the document root is not a mapping', () => {
    assert.throws(() => parseYarnBerryLockfile('- a\n- b\n'), /expected a mapping/u)
    assert.throws(() => parseYarnBerryLockfile('hello\n'), /expected a mapping/u)
  })

  it('throws on invalid YAML', () => {
    assert.throws(() => parseYarnBerryLockfile('"a@npm:^1":\n  version: "unterminated\n'))
  })

  it('reads an entry key too long for implicit YAML syntax', () => {
    const key = Array.from({ length: 80 }, (_, i) => `wide-pkg@npm:^1.${i}.0`).join(', ')
    const content = `__metadata:\n  version: 8\n\n? "${key}"\n:\n  version: 1.80.0\n`
    assert.deepStrictEqual(
      parseYarnBerryLockfile(content).map(p => p.name),
      ['wide-pkg']
    )
  })
})

describe('parseYarnBerryLockfile aliases', () => {
  it('uses the resolution name and keeps the install directory for an alias', () => {
    const content = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
`
    const [pkg] = parseYarnBerryLockfile(content)
    assert.strictEqual(pkg.name, 'string-width')
    assert.strictEqual(pkg.alias, 'string-width-cjs')
  })

  it('treats a key that also names the real package as not aliased', () => {
    const content = `__metadata:
  version: 8

"string-width-cjs@npm:string-width@^4.2.0, string-width@npm:^4.1.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
`
    const [pkg] = parseYarnBerryLockfile(content)
    assert.strictEqual(pkg.name, 'string-width')
    assert.ok(!('alias' in pkg))
  })
})

describe('parseYarnBerryLockfile sources', () => {
  const lock = (key: string, body = ''): string =>
    `__metadata:\n  version: 8\n\n"${key}":\n  version: 1.0.0\n${body}`

  // Regression: only seven protocols were recognised, so these packages vanished.
  for (const range of [
    'https://example.test/foo-1.0.0.tgz',
    'https://example.test/npm:foo-1.0.0.tgz',
    'github:me/foo',
    'git+ssh://git@github.com/me/foo.git',
    'me/foo',
    'portal:../foo',
    'file:./foo'
  ]) {
    it(`reads a package from ${range} and marks it unpublished`, () => {
      const packages = parseYarnBerryLockfile(lock(`foo@${range}`))
      assert.deepStrictEqual(
        packages.map(p => [p.name, p.version, p.unpublished]),
        [['foo', '1.0.0', true]]
      )
    })
  }

  it('reads a scoped package from a URL', () => {
    assert.strictEqual(
      parseYarnBerryLockfile(lock('@s/foo@https://example.test/foo.tgz'))[0]?.name,
      '@s/foo'
    )
  })

  // Each key's protocol class differs from its resolution's, so reading the key fails.
  it('decides from the resolution rather than the requested range', () => {
    const toTarball = lock('foo@npm:^1', '  resolution: "foo@https://example.test/foo.tgz"\n')
    assert.strictEqual(parseYarnBerryLockfile(toTarball)[0]?.unpublished, true)
    const toRegistry = lock('foo@github:me/foo', '  resolution: "foo@npm:1.0.0"\n')
    assert.ok(!('unpublished' in (parseYarnBerryLockfile(toRegistry)[0] ?? {})))
  })

  it('treats a patched registry package as published', () => {
    const patched = lock(
      'foo@patch:foo@npm%3A^1#~builtin<compat/foo>',
      '  resolution: "foo@patch:foo@npm%3A1.0.0#~builtin<compat/foo>::version=1.0.0"\n'
    )
    assert.ok(!('unpublished' in (parseYarnBerryLockfile(patched)[0] ?? {})))
  })

  it('treats a patched scoped registry package as published', () => {
    const patched = lock(
      '@me/foo@patch:@me/foo@npm%3A^1#./foo.patch',
      '  resolution: "@me/foo@patch:@me/foo@npm%3A1.0.0#./foo.patch::version=1.0.0&hash=1"\n'
    )
    assert.ok(!('unpublished' in (parseYarnBerryLockfile(patched)[0] ?? {})))
  })

  // Regression: every patch counted as published, so a patched git package's name
  // went to the registry, which could answer for an unrelated package.
  for (const [source, encoded] of [
    ['git', 'https%3A//github.com/me/foo.git%23commit=abc'],
    ['file', 'file%3A../foo']
  ]) {
    it(`treats a patched ${source} package as unpublished`, () => {
      const patched = lock(
        `foo@patch:foo@${encoded}#./foo.patch`,
        `  resolution: "foo@patch:foo@${encoded}#./foo.patch::version=1.0.0&hash=1"\n`
      )
      assert.strictEqual(parseYarnBerryLockfile(patched)[0]?.unpublished, true)
    })
  }
})
