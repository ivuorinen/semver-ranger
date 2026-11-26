import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmLockfile } from '../../src/parsers/npm.ts'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

/**
 * Parses a fixture lockfile and asserts that an express package at the given version is present.
 * @param {string} fixtureFile Fixture lockfile filename relative to the fixtures directory.
 * @param {string} expectedVersion Expected version string for the express package.
 * @returns {void}
 */
function assertExpressVersion(fixtureFile: string, expectedVersion: string): void {
  const content = readFileSync(join(fixturesDir, fixtureFile), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express)
  assert.strictEqual(express.version, expectedVersion)
}

describe('parseNpmLockfile', () => {
  it('parses v3 lockfile', () => {
    assertExpressVersion('package-lock.json', '4.19.2')
  })

  it('parses v1 lockfile', () => {
    assertExpressVersion('package-lock-v1.json', '4.19.2')
  })

  it('skips entries without version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/no-version': {}
      }
    })
    const packages = parseNpmLockfile(content)
    assert.ok(packages.some(p => p.name === 'lodash'))
    assert.ok(!packages.some(p => p.name === 'no-version'))
  })

  it('reads a v3 lockfile with no packages block as empty', () => {
    assert.deepStrictEqual(parseNpmLockfile('{"lockfileVersion":3}'), [])
  })

  it('deduplicates packages by name@version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21'
        },
        'node_modules/parent/node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21'
        },
        'node_modules/other': {
          name: 'other',
          version: '1.0.0'
        }
      }
    })
    const packages = parseNpmLockfile(content)
    const lodashEntries = packages.filter(p => p.name === 'lodash')
    assert.strictEqual(lodashEntries.length, 1)
    assert.strictEqual(lodashEntries[0].version, '4.17.21')
    assert.strictEqual(packages.length, 2) // lodash + other, not 3
  })
})

describe('parseNpmLockfile root validation', () => {
  // Regression: a `null` root was destructured, and the TypeError was printed as
  // a crash with a stack trace instead of naming the problem.
  for (const root of ['null', '[]', '"x"', '1']) {
    it(`refuses a ${root} root with a message, not a TypeError`, () => {
      assert.throws(
        () => parseNpmLockfile(root),
        (err: unknown) =>
          !(err instanceof TypeError) &&
          /unrecognised package-lock\.json: expected an object/u.test(String(err))
      )
    })
  }
})

describe('parseNpmLockfile version validation', () => {
  // Regression: a missing or non-numeric lockfileVersion fell through to the
  // v1 branch, which reads `dependencies` — so a malformed lockfile was
  // reported as one with no dependencies instead of as an error.
  it('throws when lockfileVersion is missing', () => {
    assert.throws(
      () => parseNpmLockfile(JSON.stringify({ packages: {} })),
      /expected a numeric "lockfileVersion"/u
    )
  })

  it('throws when lockfileVersion is not a number', () => {
    assert.throws(
      () => parseNpmLockfile(JSON.stringify({ lockfileVersion: '3', packages: {} })),
      /expected a numeric "lockfileVersion"/u
    )
  })

  it('throws when lockfileVersion overflows to Infinity', () => {
    assert.throws(
      () => parseNpmLockfile('{"lockfileVersion":1e999,"packages":{}}'),
      /expected a numeric "lockfileVersion"/u
    )
  })

  it('throws on an unsupported lockfileVersion', () => {
    assert.throws(
      () => parseNpmLockfile(JSON.stringify({ lockfileVersion: 0, dependencies: {} })),
      /unsupported package-lock.json lockfileVersion: 0/u
    )
  })

  it('still accepts v1 and v3', () => {
    const v1 = parseNpmLockfile(
      JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0' } } })
    )
    assert.deepStrictEqual(v1, [{ name: 'a', version: '1.0.0' }])

    const v3 = parseNpmLockfile(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': {}, 'node_modules/a': { version: '2.0.0' } }
      })
    )
    assert.strictEqual(v3.length, 1)
    assert.strictEqual(v3[0].version, '2.0.0')
  })
})

describe('parseNpmLockfile rejects unsupported versions', () => {
  // Regression: `lockfileVersion >= 2` accepted 4 and 2.5, contradicting the
  // documented "supports 1, 2, and 3" contract and parsing an unknown future
  // schema as if it were v3.
  it('throws on a future major lockfileVersion', () => {
    assert.throws(
      () => parseNpmLockfile(JSON.stringify({ lockfileVersion: 4, packages: {} })),
      /unsupported package-lock.json lockfileVersion: 4/u
    )
  })

  it('throws on a fractional lockfileVersion', () => {
    assert.throws(
      () => parseNpmLockfile(JSON.stringify({ lockfileVersion: 2.5, packages: {} })),
      /unsupported package-lock.json lockfileVersion: 2.5/u
    )
  })

  it('accepts exactly 2', () => {
    const out = parseNpmLockfile(
      JSON.stringify({
        lockfileVersion: 2,
        packages: { '': {}, 'node_modules/a': { version: '1.2.3' } }
      })
    )
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0].name, 'a')
    assert.strictEqual(out[0].version, '1.2.3')
  })
})

describe('parseNpmLockfile names and nesting', () => {
  const v3 = (packages: Record<string, unknown>) =>
    parseNpmLockfile(JSON.stringify({ lockfileVersion: 3, packages }))

  it('reads versions nested under a v1 entry', () => {
    const packages = parseNpmLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          a: { version: '1.0.0', dependencies: { b: { version: '1.0.0' } } },
          b: { version: '2.0.0' }
        }
      })
    )
    assert.deepStrictEqual(
      packages.map(p => `${p.name}@${p.version}`),
      ['a@1.0.0', 'b@1.0.0', 'b@2.0.0']
    )
  })

  it('resolves a v1 alias to its real package', () => {
    const packages = parseNpmLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: { 'string-width-cjs': { version: 'npm:string-width@4.2.3' } }
      })
    )
    assert.deepStrictEqual(packages, [
      { name: 'string-width', version: '4.2.3', alias: 'string-width-cjs' }
    ])
  })

  const v1 = (dependencies: Record<string, unknown>) =>
    parseNpmLockfile(JSON.stringify({ lockfileVersion: 1, dependencies }))

  it('resolves a v1 alias to a scoped package', () => {
    assert.deepStrictEqual(v1({ nick: { version: 'npm:@real/pkg@1.2.3' } }), [
      { name: '@real/pkg', version: '1.2.3', alias: 'nick' }
    ])
  })

  it('does not treat a v1 URL containing "npm:" as an alias', () => {
    const version = 'git+https://example.test/npm:thing@1.0.0'
    assert.deepStrictEqual(v1({ thing: { version } }), [
      { name: 'thing', version, unpublished: true }
    ])
  })

  it('does not mark a v1 registry package or alias as unpublished', () => {
    assert.deepStrictEqual(v1({ a: { version: '1.0.0' } }), [{ name: 'a', version: '1.0.0' }])
    assert.deepStrictEqual(v1({ nick: { version: 'npm:real@2.0.0' } }), [
      { name: 'real', version: '2.0.0', alias: 'nick' }
    ])
  })

  it('lists a v1 package once however many times it is nested', () => {
    const nested = { c: { version: '3.0.0' } }
    const packages = v1({
      a: { version: '1.0.0', dependencies: nested },
      b: { version: '1.0.0', dependencies: nested }
    })
    assert.deepStrictEqual(
      packages.map(p => `${p.name}@${p.version}`),
      ['a@1.0.0', 'c@3.0.0', 'b@1.0.0']
    )
  })

  it('does not mark an ordinary package as an alias', () => {
    assert.ok(!('alias' in v3({ 'node_modules/a': { version: '1.0.0' } })[0]))
  })

  it('uses the real name of a v3 alias and keeps its install directory', () => {
    const [pkg] = v3({
      'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3' }
    })
    assert.strictEqual(pkg.name, 'string-width')
    assert.strictEqual(pkg.alias, 'string-width-cjs')
  })

  // Regression: deduped by installed name, the alias doubled the package's rows.
  it('lists an alias and its real package at one version once', () => {
    const packages = v3({
      'node_modules/string-width': { version: '4.2.3' },
      'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3' }
    })
    assert.deepStrictEqual(
      packages.map(p => `${p.name}@${p.version}`),
      ['string-width@4.2.3']
    )
  })

  it('names a workspace member from its manifest and marks it', () => {
    const [pkg] = v3({ 'packages/a': { name: '@me/a', version: '1.0.0' } })
    assert.strictEqual(pkg.name, '@me/a')
    assert.strictEqual(pkg.unpublished, true)
  })

  it('falls back to the directory name for a workspace with no name field', () => {
    assert.strictEqual(v3({ 'packages/app': { version: '1.0.0' } })[0].name, 'app')
    assert.strictEqual(v3({ app: { version: '1.0.0' } })[0].name, 'app')
  })

  // Regression: npm omits `name` when it matches the folder, scope included,
  // so a scoped member lost its scope and looked like a different package.
  it('keeps the scope of a workspace folder with no name field', () => {
    assert.strictEqual(v3({ 'packages/@me/app': { version: '1.0.0' } })[0].name, '@me/app')
    assert.strictEqual(v3({ '@me/app': { version: '1.0.0' } })[0].name, '@me/app')
  })

  it('only treats a parent folder as a scope when it starts with @', () => {
    assert.strictEqual(v3({ 'packages/a@b/app': { version: '1.0.0' } })[0].name, 'app')
  })

  for (const resolved of [
    'git+ssh://git@github.com/me/foo.git#abc',
    'git+https://gitlab.example.com/group/-/foo-1.0.0.tgz',
    'https://gitlab.example.com/me/foo/-/archive/v1.0.0/foo-v1.0.0.tgz',
    'file:vendor/foo-1.0.0.tgz',
    'https://example.test/foo-1.0.0.tgz'
  ]) {
    it(`marks ${resolved} as unpublished`, () => {
      const [pkg] = v3({ 'node_modules/foo': { version: '1.0.0', resolved } })
      assert.strictEqual(pkg.unpublished, true)
    })
  }

  for (const source of [
    { resolved: 'https://registry.npmjs.org/foo/-/foo-1.0.0.tgz' },
    { resolved: 'http://localhost:4873/@me/foo/-/foo-1.0.0.tgz' },
    { resolved: 'https://gitlab.example.com/api/v4/packages/npm/@me/foo/-/@me/foo-1.0.0.tgz' },
    { resolved: 'https://npm.pkg.github.com/download/@me/foo/1.0.0/abc' },
    {}
  ]) {
    it(`treats ${JSON.stringify(source)} as coming from a registry`, () => {
      const [pkg] = v3({ 'node_modules/foo': { version: '1.0.0', ...source } })
      assert.ok(!('unpublished' in pkg))
    })
  }

  it('skips the root entry even when it has a version', () => {
    assert.deepStrictEqual(v3({ '': { name: 'root', version: '1.0.0' } }), [])
  })
})
