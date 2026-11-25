import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePnpmLockfile } from '../../src/parsers/pnpm.ts'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('parsePnpmLockfile', () => {
  it('parses pnpm v6 lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('extracts engines from pnpm lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    const express = packages.find(p => p.name === 'express')
    assert.strictEqual(express?.engines?.node, '>= 0.10.0')
  })

  it('handles package with no engines field', () => {
    const content = [
      "lockfileVersion: '6.0'",
      'packages:',
      '  /lodash@4.17.21:',
      '    resolution: { integrity: sha512-abc }'
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const lodash = packages.find(p => p.name === 'lodash')
    assert.ok(lodash)
    assert.ok(typeof lodash.engines === 'undefined')
  })

  it('extracts peerDependencies from pnpm lockfile', () => {
    const content = [
      "lockfileVersion: '6.0'",
      'packages:',
      '  /react-dom@18.0.0:',
      '    resolution: { integrity: sha512-abc }',
      '    peerDependencies:',
      '      react: ^18.0.0'
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const reactDom = packages.find(p => p.name === 'react-dom')
    assert.ok(reactDom)
    assert.strictEqual(reactDom.peerDependencies?.react, '^18.0.0')
  })

  it('skips keys that cannot be parsed', () => {
    const content = [
      "lockfileVersion: '6.0'",
      'packages:',
      '  invalid-key-no-version:',
      '    resolution: { integrity: sha512-abc }'
    ].join('\n')
    assert.deepStrictEqual(parsePnpmLockfile(content), [])
  })

  it('reads a lockfile with no packages as empty', () => {
    assert.deepStrictEqual(parsePnpmLockfile("lockfileVersion: '9.0'\n"), [])
  })

  it('reads snapshots when there is no packages block', () => {
    const [pkg] = parsePnpmLockfile("lockfileVersion: '9.0'\nsnapshots:\n  a@1.0.0: {}\n")
    assert.strictEqual(pkg.name, 'a')
    assert.strictEqual(pkg.version, '1.0.0')
    assert.ok(typeof pkg.engines === 'undefined')
  })

  it('deduplicates packages with same name and version', () => {
    const content = [
      "lockfileVersion: '6.0'",
      'packages:',
      '  /lodash@4.17.21:',
      '    resolution: { integrity: sha512-abc }',
      '  /lodash@4.17.21(peer@1.0.0):',
      '    resolution: { integrity: sha512-abc }'
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const lodashEntries = packages.filter(p => p.name === 'lodash')
    assert.strictEqual(lodashEntries.length, 1)
  })

  it('extracts engines from pnpm v9 lockfile (packages block)', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock-v9.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express, 'express package found')
    assert.strictEqual(express.engines?.node, '>= 0.10.0')
  })
})

describe('parsePnpmLockfile keys', () => {
  const ids = (content: string) => parsePnpmLockfile(content).map(p => `${p.name}@${p.version}`)

  it('reads every scoped and unscoped package of a v6 lockfile', () => {
    const content = `lockfileVersion: '6.0'
packages:
  /@scope/name@1.2.3: {}
  /plain@2.0.0: {}
  /plain@2.1.0: {}
`
    assert.deepStrictEqual(ids(content), ['@scope/name@1.2.3', 'plain@2.0.0', 'plain@2.1.0'])
  })

  it('reads every scoped and unscoped package of a v9 lockfile', () => {
    const content = `lockfileVersion: '9.0'
snapshots:
  '@scope/name@1.2.3': {}
  plain@2.0.0: {}
`
    assert.deepStrictEqual(ids(content), ['@scope/name@1.2.3', 'plain@2.0.0'])
  })

  it('leaves no space in the version when one precedes the peer suffix', () => {
    const content = "lockfileVersion: '9.0'\nsnapshots:\n  'a@1.0.0 (b@2.0.0)': {}\n"
    assert.deepStrictEqual(ids(content), ['a@1.0.0'])
  })

  it('marks its packages as carrying lockfile metadata', () => {
    const [pkg] = parsePnpmLockfile("lockfileVersion: '9.0'\nsnapshots:\n  a@1.0.0: {}\n")
    assert.strictEqual(pkg.hasMetadata, true)
  })
})

describe('parsePnpmLockfile v9 peer suffixes', () => {
  // Regression: metadata was looked up with the unstripped snapshot key, so any
  // package with a peer-resolution suffix silently lost engines/peerDependencies.
  const V9_WITH_PEERS = `lockfileVersion: '9.0'
packages:
  vue-router@4.2.5:
    resolution: { integrity: sha512-x }
    engines: { node: '>=18' }
    peerDependencies:
      vue: ^3.2.0
snapshots:
  vue-router@4.2.5(vue@3.3.4):
    dependencies:
      vue: 3.3.4
`

  it('keeps engines for a peer-suffixed snapshot key', () => {
    const packages = parsePnpmLockfile(V9_WITH_PEERS)
    assert.strictEqual(packages.length, 1)
    assert.deepStrictEqual(packages[0].engines, { node: '>=18' })
  })

  it('keeps peerDependencies for a peer-suffixed snapshot key', () => {
    const packages = parsePnpmLockfile(V9_WITH_PEERS)
    assert.deepStrictEqual(packages[0].peerDependencies, { vue: '^3.2.0' })
  })
})

describe('parsePnpmLockfile v6 peer suffixes', () => {
  // v6 suffixes the packages key itself, so only the full key finds the metadata.
  it('keeps engines and peerDependencies for a peer-suffixed v6 key', () => {
    const [pkg] = parsePnpmLockfile(`lockfileVersion: '6.0'
packages:
  /a@1.0.0(b@2.0.0):
    engines: {node: '>=18'}
    peerDependencies:
      b: ^2
`)
    assert.deepStrictEqual(
      [pkg.name, pkg.version, pkg.engines, pkg.peerDependencies],
      ['a', '1.0.0', { node: '>=18' }, { b: '^2' }]
    )
  })
})

describe('parsePnpmLockfile nested peers and versions', () => {
  // Regression: a nested suffix left a stray ")" in the version and lost the metadata.
  it('keeps version and metadata for a nested peer suffix', () => {
    const [pkg] = parsePnpmLockfile(`lockfileVersion: '9.0'
packages:
  a@1.0.0:
    engines: {node: '>=20'}
    peerDependencies:
      b: '*'
snapshots:
  a@1.0.0(b@2.0.0(c@3.0.0))(d@4.0.0): {}
`)
    assert.strictEqual(pkg.version, '1.0.0')
    assert.deepStrictEqual(pkg.engines, { node: '>=20' })
    assert.deepStrictEqual(pkg.peerDependencies, { b: '*' })
  })

  it('rejects a lockfile older than version 6', () => {
    assert.throws(
      () => parsePnpmLockfile('lockfileVersion: 5.4\npackages:\n  /foo/1.0.0: {}\n'),
      /unsupported pnpm-lock\.yaml lockfileVersion: 5\.4 \(expected 6 or later\)/u
    )
  })

  it('rejects a lockfile with no version', () => {
    assert.throws(() => parsePnpmLockfile('packages: {}\n'), /unsupported pnpm-lock\.yaml/u)
  })

  it('rejects a document whose root is not a mapping', () => {
    for (const content of ['', '- a\n', 'hello\n']) {
      assert.throws(() => parsePnpmLockfile(content), /expected a mapping/u, content)
    }
  })

  it('rejects malformed YAML', () => {
    assert.throws(() => parsePnpmLockfile("lockfileVersion: '9.0'\npackages: {\n"), /YAML|flow/iu)
  })
})

describe('parsePnpmLockfile env document', () => {
  // What pnpm 12 writes when package.json has "packageManager": the env
  // document with pnpm itself comes first, the project's lockfile second.
  const content = `---
lockfileVersion: '9.0'
importers:
  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.6.0
        version: 12.6.0
packages:
  pnpm@12.6.0:
    resolution: {integrity: sha512-abc}
    engines: {node: '>=22.13'}
snapshots:
  pnpm@12.6.0: {}

---
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      ms:
        specifier: 2.1.3
        version: 2.1.3
packages:
  ms@2.1.3:
    resolution: {integrity: sha512-def}
snapshots:
  ms@2.1.3: {}
`

  it('reads the lockfile that follows the env document and ignores the env document', () => {
    assert.deepStrictEqual(
      parsePnpmLockfile(content).map(p => `${p.name}@${p.version}`),
      ['ms@2.1.3']
    )
  })
})

describe('parsePnpmLockfile sources', () => {
  it('marks a package whose version is its source as unpublished', () => {
    const content = `lockfileVersion: '9.0'
snapshots:
  isobject@https://codeload.github.com/a/b/tar.gz/ae2b5ea1: {}
  local@file:packages/local: {}
  a@1.0.0: {}
`
    assert.deepStrictEqual(
      parsePnpmLockfile(content).map(p => [p.name, p.unpublished === true]),
      [
        ['isobject', true],
        ['local', true],
        ['a', false]
      ]
    )
  })

  // Regression: v6 keys these by source rather than name@version, so they vanished.
  it('reads a v6 git or directory package from its entry, even with an @ in its path', () => {
    const content = `lockfileVersion: '6.0'
packages:
  file:../localdep:
    resolution: {directory: ../localdep, type: directory}
    name: localdep
    engines: {node: '>=22'}
  file:../../@me/scoped:
    resolution: {directory: ../../@me/scoped, type: directory}
    name: '@me/scoped'
  github.com/me/is-number/98e8ff1:
    resolution: {tarball: https://codeload.github.com/me/is-number/tar.gz/98e8ff1}
    name: is-number
    version: 7.0.0
    engines: {node: '>=0.12.0'}
`
    assert.deepStrictEqual(
      parsePnpmLockfile(content).map(p => [
        `${p.name}@${p.version}`,
        p.engines?.node ?? null,
        p.unpublished
      ]),
      [
        ['localdep@file:../localdep', '>=22', true],
        ['@me/scoped@file:../../@me/scoped', null, true],
        ['is-number@7.0.0', '>=0.12.0', true]
      ]
    )
  })

  // Regression: v9 keys these by name and source URL, and the URL was shown as the version.
  it('reads a v9 git package version from its entry and keeps it unpublished', () => {
    const content = `lockfileVersion: '9.0'
packages:
  is-number@https://codeload.github.com/me/is-number/tar.gz/98e8ff1:
    resolution: {tarball: https://codeload.github.com/me/is-number/tar.gz/98e8ff1}
    version: 7.0.0
snapshots:
  is-number@https://codeload.github.com/me/is-number/tar.gz/98e8ff1: {}
`
    assert.deepStrictEqual(
      parsePnpmLockfile(content).map(p => [`${p.name}@${p.version}`, p.unpublished]),
      [['is-number@7.0.0', true]]
    )
  })
})

describe('parsePnpmLockfile parsing cost', () => {
  const content = "lockfileVersion: '9.0'\npackages:\n  a@1.0.0:\n    engines: {node: '>=18'}\n"

  // Regression: yaml's duplicate-key check made parsing quadratic in the package count.
  it('reads a lockfile that repeats a key, as the duplicate-key check is off', () => {
    const repeated = `${content}  a@1.0.0:\n    engines: {node: '>=20'}\n`
    assert.deepStrictEqual(parsePnpmLockfile(repeated)[0]?.engines, { node: '>=20' })
  })

  // Regression: --no-dev parsed the lockfile a second time. One parse yields one object.
  it('parses the same content once', () => {
    assert.strictEqual(
      parsePnpmLockfile(content)[0]?.engines,
      parsePnpmLockfile(content)[0]?.engines
    )
  })
})
