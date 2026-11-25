import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  filterDevPackages,
  filterReadsManifest,
  filtersAfterRegistry
} from '../../src/graph/index.ts'
import type { LockfileType, Package } from '../../src/types.ts'

const root = mkdtempSync(join(tmpdir(), 'semver-ranger-graph-'))
let projects = 0

after(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Creates a project directory.
 * @param {Record<string, unknown>} files File contents by path; non-strings become JSON.
 * @returns {string} The project directory.
 */
function project(files: Record<string, unknown> = {}): string {
  projects += 1
  const dir = join(root, String(projects))
  mkdirSync(dir)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

/**
 * Turns `name@version` into a package.
 * @param {string} id The package identity.
 * @returns {Package} The package.
 */
function pkg(id: string): Package {
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), version: id.slice(at + 1) }
}

/**
 * Filters packages and reports which survive.
 * @param {string[]} ids Each package as `name@version`.
 * @param {string} content The lockfile.
 * @param {LockfileType} type The lockfile format.
 * @param {string} dir The project directory.
 * @returns {string[]} The surviving identities.
 */
function kept(ids: string[], content: string, type: LockfileType, dir = project()): string[] {
  return filterDevPackages(ids.map(pkg), dir, content, type).map(p => `${p.name}@${p.version}`)
}

describe('what each format needs before it can filter', () => {
  const types: LockfileType[] = ['npm', 'pnpm', 'yarn-classic', 'yarn-berry']

  // Regression: the CLI hard-coded this; it belongs beside the format dispatch.
  it('filters only Yarn Classic after the registry pass, as yarn.lock records no peers', () => {
    assert.deepStrictEqual(types.filter(filtersAfterRegistry), ['yarn-classic'])
  })

  // Regression: --no-dev demanded package.json for npm and pnpm too.
  it('reads package.json only for the Yarn formats', () => {
    assert.deepStrictEqual(types.filter(filterReadsManifest), ['yarn-classic', 'yarn-berry'])
  })
})

describe('filterDevPackages on npm lockfiles', () => {
  const lock = (packages: Record<string, unknown>): string =>
    JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } })

  it('removes the entries npm flags as dev and keeps the rest', () => {
    const content = lock({
      'node_modules/prod': { version: '1.0.0' },
      'node_modules/tool': { version: '1.0.0', dev: true }
    })
    assert.deepStrictEqual(kept(['prod@1.0.0', 'tool@1.0.0'], content, 'npm'), ['prod@1.0.0'])
  })

  it('reads the flag at every depth of a v1 tree', () => {
    const content = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        prod: { version: '1.0.0' },
        tool: {
          version: '1.0.0',
          dev: true,
          dependencies: { inner: { version: '2.0.0', dev: true } }
        }
      }
    })
    assert.deepStrictEqual(kept(['prod@1.0.0', 'tool@1.0.0', 'inner@2.0.0'], content, 'npm'), [
      'prod@1.0.0'
    ])
  })

  it('keeps optional, peer and dev-or-optional entries, which production installs', () => {
    const content = lock({
      'node_modules/a': { version: '1.0.0', optional: true },
      'node_modules/b': { version: '1.0.0', peer: true },
      'node_modules/c': { version: '1.0.0', devOptional: true }
    })
    const all = ['a@1.0.0', 'b@1.0.0', 'c@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'npm'), all)
  })

  it('removes a dev-only nested version and keeps the production one', () => {
    const content = lock({
      'node_modules/foo': { version: '1.0.0' },
      'node_modules/tool/node_modules/foo': { version: '2.0.0', dev: true }
    })
    assert.deepStrictEqual(kept(['foo@1.0.0', 'foo@2.0.0'], content, 'npm'), ['foo@1.0.0'])
  })

  it('keeps a version installed both as a dev copy and a production copy', () => {
    const content = lock({
      'node_modules/a/node_modules/foo': { version: '1.0.0' },
      'node_modules/tool/node_modules/foo': { version: '1.0.0', dev: true }
    })
    assert.deepStrictEqual(kept(['foo@1.0.0'], content, 'npm'), ['foo@1.0.0'])
  })

  it('matches an alias through its real package', () => {
    const content = lock({ 'node_modules/nick': { name: 'real', version: '1.0.0', dev: true } })
    assert.deepStrictEqual(kept(['real@1.0.0'], content, 'npm'), [])
  })

  it('keeps a package the lockfile does not mention', () => {
    assert.deepStrictEqual(kept(['ghost@1.0.0'], lock({}), 'npm'), ['ghost@1.0.0'])
  })
})

describe('filterDevPackages on pnpm lockfiles', () => {
  const v9 = (importers: string, snapshots: string): string =>
    `lockfileVersion: '9.0'\nimporters:\n${importers}\nsnapshots:\n${snapshots}\n`

  it('walks production and dev roots through their dependencies', () => {
    const content = v9(
      `  .:
    dependencies:
      prod: {specifier: ^1, version: 1.0.0}
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}`,
      `  prod@1.0.0:
    dependencies:
      shared: 1.0.0
  tool@1.0.0:
    dependencies:
      shared: 1.0.0
      transitive: 1.0.0
  shared@1.0.0: {}
  transitive@1.0.0: {}`
    )
    const all = ['prod@1.0.0', 'shared@1.0.0', 'tool@1.0.0', 'transitive@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'pnpm'), ['prod@1.0.0', 'shared@1.0.0'])
  })

  it('reads a v6 lockfile with the root blocks at the top level', () => {
    const content = `lockfileVersion: '6.0'
dependencies:
  prod: {specifier: ^1, version: 1.0.0}
devDependencies:
  nick: {specifier: npm:real@1, version: /real@1.0.0}
  tool: {specifier: ^1, version: 1.0.0}
packages:
  /prod@1.0.0:
    dependencies:
      shared: 1.0.0
  /tool@1.0.0:
    dependencies:
      shared: 1.0.0
      transitive: 1.0.0
  /real@1.0.0: {}
  /shared@1.0.0: {}
  /transitive@1.0.0: {}
`
    const all = ['prod@1.0.0', 'real@1.0.0', 'shared@1.0.0', 'tool@1.0.0', 'transitive@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'pnpm'), ['prod@1.0.0', 'shared@1.0.0'])
  })

  // Regression: optional dependencies were never followed, so these were reachable from nothing.
  it('counts optional dependencies of the root and of packages as production', () => {
    const content = v9(
      `  .:
    optionalDependencies:
      opt: {specifier: ^1, version: 1.0.0}
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}`,
      `  opt@1.0.0:
    optionalDependencies:
      inner: 1.0.0
  tool@1.0.0:
    dependencies:
      inner: 1.0.0
  inner@1.0.0: {}`
    )
    assert.deepStrictEqual(kept(['opt@1.0.0', 'inner@1.0.0', 'tool@1.0.0'], content, 'pnpm'), [
      'opt@1.0.0',
      'inner@1.0.0'
    ])
  })

  it('walks every workspace importer', () => {
    const content = v9(
      `  .: {}
  packages/a:
    dependencies:
      ms: {specifier: ^2, version: 2.1.3}
      sibling: {specifier: workspace:*, version: link:../sibling}
    devDependencies:
      debug: {specifier: ^4, version: 4.3.7}`,
      `  ms@2.1.3: {}
  debug@4.3.7: {}`
    )
    assert.deepStrictEqual(kept(['ms@2.1.3', 'debug@4.3.7'], content, 'pnpm'), ['ms@2.1.3'])
  })

  // Regression: a dev alias never matched, because the importer key is not the real name.
  it('follows an aliased root to the package it names', () => {
    const content = v9(
      `  .:
    devDependencies:
      nick: {specifier: npm:real@1, version: real@1.0.0}`,
      '  real@1.0.0: {}'
    )
    assert.deepStrictEqual(kept(['real@1.0.0'], content, 'pnpm'), [])
  })

  it('tells versions of one package apart', () => {
    const content = v9(
      `  .:
    dependencies:
      foo: {specifier: ^1, version: 1.0.0}
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}`,
      `  foo@1.0.0: {}
  foo@2.0.0: {}
  tool@1.0.0:
    dependencies:
      foo: 2.0.0`
    )
    assert.deepStrictEqual(kept(['foo@1.0.0', 'foo@2.0.0'], content, 'pnpm'), ['foo@1.0.0'])
  })

  it('tells peer-resolved variants of one package apart', () => {
    const content = v9(
      `  .:
    dependencies:
      a: {specifier: ^1, version: 1.0.0(b@1.0.0)}
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}`,
      `  a@1.0.0(b@1.0.0):
    dependencies:
      b: 1.0.0
  a@1.0.0(b@2.0.0):
    dependencies:
      b: 2.0.0
  b@1.0.0: {}
  b@2.0.0: {}
  tool@1.0.0:
    dependencies:
      a: 1.0.0(b@2.0.0)`
    )
    assert.deepStrictEqual(kept(['a@1.0.0', 'b@1.0.0', 'b@2.0.0'], content, 'pnpm'), [
      'a@1.0.0',
      'b@1.0.0'
    ])
  })

  // Regression: the @ in the URL was parsed as a name separator, inventing a package.
  it('follows a dependency whose reference is a URL containing @', () => {
    const url = 'https://r.example/pkg@1.tgz'
    const content = v9(
      `  .:
    devDependencies:
      dep: {specifier: '${url}', version: '${url}'}`,
      `  'dep@${url}':
    dependencies:
      inner: 1.0.0
  inner@1.0.0: {}`
    )
    assert.deepStrictEqual(kept([`dep@${url}`, 'inner@1.0.0'], content, 'pnpm'), [])
  })

  it('tolerates an entry with no body, a key with no version and a null reference', () => {
    const content = v9(
      `  .:
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}
      nothing: null`,
      `  tool@1.0.0:
  no-version: {}`
    )
    assert.deepStrictEqual(kept(['tool@1.0.0', 'other@1.0.0'], content, 'pnpm'), ['other@1.0.0'])
  })

  it('reads a lockfile with no packages', () => {
    assert.deepStrictEqual(kept(['a@1.0.0'], "lockfileVersion: '9.0'\n", 'pnpm'), ['a@1.0.0'])
  })

  it('stops at a dependency cycle', { timeout: 5000 }, () => {
    const content = v9(
      `  .:
    devDependencies:
      a: {specifier: ^1, version: 1.0.0}`,
      `  a@1.0.0:
    dependencies:
      b: 1.0.0
  b@1.0.0:
    dependencies:
      a: 1.0.0`
    )
    assert.deepStrictEqual(kept(['a@1.0.0', 'b@1.0.0'], content, 'pnpm'), [])
  })

  it('walks the lockfile that follows the env document pnpm 11+ writes first', () => {
    const content = `---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: {specifier: 12.6.0, version: 12.6.0}
snapshots:
  pnpm@12.6.0: {}
---
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      ms: {specifier: 2.1.3, version: 2.1.3}
    devDependencies:
      tool: {specifier: ^1, version: 1.0.0}
snapshots:
  ms@2.1.3: {}
  tool@1.0.0: {}
`
    assert.deepStrictEqual(kept(['ms@2.1.3', 'tool@1.0.0'], content, 'pnpm'), ['ms@2.1.3'])
  })

  // Regression: v6 keys these by source, so the walk ended at them and lost what they need.
  it('walks through v6 packages keyed by their git or directory source', () => {
    const content = `lockfileVersion: '6.0'
dependencies:
  localdep: {specifier: file:../localdep, version: file:../localdep}
  is-number: {specifier: github:me/is-number, version: github.com/me/is-number/98e8ff1}
devDependencies:
  tool: {specifier: ^1, version: 1.0.0}
packages:
  file:../localdep:
    name: localdep
    dependencies:
      ms: 2.1.3
  github.com/me/is-number/98e8ff1:
    name: is-number
    version: 7.0.0
    dependencies:
      kind: 1.0.0
  /kind@1.0.0: {}
  /ms@2.1.3: {}
  /tool@1.0.0:
    dependencies:
      kind: 1.0.0
      ms: 2.1.3
`
    const all = ['localdep@file:../localdep', 'is-number@7.0.0', 'kind@1.0.0', 'ms@2.1.3']
    assert.deepStrictEqual(kept([...all, 'tool@1.0.0'], content, 'pnpm'), all)
  })

  // Regression: the list named a v9 git package by its real version, the walk must too.
  it('removes a dev-only v9 git package under the version its entry records', () => {
    const url = 'https://codeload.github.com/me/is-number/tar.gz/98e8ff1'
    const content = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      prod: {specifier: ^1, version: 1.0.0}
    devDependencies:
      is-number: {specifier: github:me/is-number, version: ${url}}
packages:
  is-number@${url}:
    version: 7.0.0
snapshots:
  is-number@${url}: {}
  prod@1.0.0: {}
`
    const ids = ['prod@1.0.0', 'is-number@7.0.0']
    assert.deepStrictEqual(kept(ids, content, 'pnpm'), ['prod@1.0.0'])
  })
})

describe('filterDevPackages on yarn classic lockfiles', () => {
  const entry = (specifier: string, version: string, body = ''): string =>
    `${specifier}:\n  version "${version}"\n${body}\n`
  const manifest = { dependencies: { prod: '^1' }, devDependencies: { tool: '^1' } }

  it('walks production and dev roots through their dependencies', () => {
    const content = [
      entry('prod@^1', '1.0.0', '  dependencies:\n    shared "^1"\n'),
      entry('tool@^1', '1.0.0', '  dependencies:\n    shared "^1"\n    transitive "^1"\n'),
      entry('shared@^1', '1.0.0'),
      entry('transitive@^1', '1.0.0')
    ].join('\n')
    const all = ['prod@1.0.0', 'shared@1.0.0', 'tool@1.0.0', 'transitive@1.0.0']
    const dir = project({ 'package.json': manifest })
    assert.deepStrictEqual(kept(all, content, 'yarn-classic', dir), ['prod@1.0.0', 'shared@1.0.0'])
  })

  // Regression: only `dependencies:` was read, so these looked dev-only.
  it('counts optional dependencies of the root and of packages as production', () => {
    const content = [
      entry('opt@^1', '1.0.0', '  optionalDependencies:\n    inner "^1"\n'),
      entry('tool@^1', '1.0.0', '  dependencies:\n    inner "^1"\n'),
      entry('inner@^1', '1.0.0')
    ].join('\n')
    const dir = project({
      'package.json': { optionalDependencies: { opt: '^1' }, devDependencies: { tool: '^1' } }
    })
    assert.deepStrictEqual(
      kept(['opt@1.0.0', 'inner@1.0.0', 'tool@1.0.0'], content, 'yarn-classic', dir),
      ['opt@1.0.0', 'inner@1.0.0']
    )
  })

  it('tells versions of one package apart by the range that asked for them', () => {
    const content = [
      entry('foo@^1', '1.0.0'),
      entry('foo@^2', '2.0.0'),
      entry('tool@^1', '1.0.0', '  dependencies:\n    foo "^2"\n')
    ].join('\n')
    const dir = project({
      'package.json': { dependencies: { foo: '^1' }, devDependencies: { tool: '^1' } }
    })
    assert.deepStrictEqual(kept(['foo@1.0.0', 'foo@2.0.0'], content, 'yarn-classic', dir), [
      'foo@1.0.0'
    ])
  })

  it('ignores a dependency line that belongs to no entry', () => {
    const content = `    orphan "^1"\n${entry('tool@^1', '1.0.0')}`
    const dir = project({ 'package.json': { devDependencies: { tool: '^1' } } })
    assert.deepStrictEqual(kept(['tool@1.0.0'], content, 'yarn-classic', dir), [])
  })

  it('reads quoted scoped names, ranges with spaces and unquoted ranges', () => {
    const content = [
      entry('tool@^1', '1.0.0', '  dependencies:\n    "@s/a" "^1 || ^2"\n    b latest\n'),
      entry('"@s/a@^1 || ^2"', '1.0.0'),
      entry('b@latest', '1.0.0')
    ].join('\n')
    const dir = project({ 'package.json': { devDependencies: { tool: '^1' } } })
    assert.deepStrictEqual(kept(['@s/a@1.0.0', 'b@1.0.0'], content, 'yarn-classic', dir), [])
  })

  it('finds every specifier of a merged header, aliases included', () => {
    const content = [entry('real@^1, "nick@npm:real@^1"', '1.0.0')].join('\n')
    const viaAlias = project({ 'package.json': { devDependencies: { nick: 'npm:real@^1' } } })
    assert.deepStrictEqual(kept(['real@1.0.0'], content, 'yarn-classic', viaAlias), [])
    const viaName = project({ 'package.json': { devDependencies: { real: '^1' } } })
    assert.deepStrictEqual(kept(['real@1.0.0'], content, 'yarn-classic', viaName), [])
  })

  it('credits an aliased entry to the real package', () => {
    const content = entry('"nick@npm:real@^1"', '1.0.0')
    const dir = project({ 'package.json': { devDependencies: { nick: 'npm:real@^1' } } })
    assert.deepStrictEqual(kept(['real@1.0.0', 'nick@1.0.0'], content, 'yarn-classic', dir), [
      'nick@1.0.0'
    ])
  })

  it('skips a malformed dependency line', () => {
    const content =
      entry('tool@^1', '1.0.0', '  dependencies:\n    "\n    b "^1"\n') + entry('b@^1', '1.0.0')
    const dir = project({ 'package.json': { devDependencies: { tool: '^1' } } })
    assert.deepStrictEqual(kept(['b@1.0.0'], content, 'yarn-classic', dir), [])
  })

  it('removes nothing without a package.json', () => {
    const content = entry('tool@^1', '1.0.0')
    assert.deepStrictEqual(kept(['tool@1.0.0'], content, 'yarn-classic'), ['tool@1.0.0'])
  })

  describe('workspaces', () => {
    const content = [
      entry('ms@^2', '2.1.3'),
      entry('debug@^4', '4.3.7'),
      entry('bare@^1', '1.0.0')
    ].join('\n')
    const member = { dependencies: { ms: '^2' }, devDependencies: { debug: '^4' } }

    // Regression: yarn.lock has no workspace entries, so their dependencies had no root.
    for (const [label, workspaces] of [
      ['an array', ['packages/*']],
      ['an object', { packages: ['packages/*'] }]
    ] as const) {
      it(`reads member manifests from ${label} of workspace globs`, () => {
        const dir = project({
          'package.json': { devDependencies: { ms: '^2', debug: '^4' }, workspaces },
          'packages/a/package.json': member
        })
        assert.deepStrictEqual(kept(['ms@2.1.3', 'debug@4.3.7'], content, 'yarn-classic', dir), [
          'ms@2.1.3'
        ])
      })
    }

    it('does not take a manifest under node_modules for a member', () => {
      const dir = project({
        'package.json': { devDependencies: { ms: '^2' }, workspaces: ['packages/**'] },
        'packages/node_modules/x/package.json': { dependencies: { ms: '^2' } }
      })
      assert.deepStrictEqual(kept(['ms@2.1.3'], content, 'yarn-classic', dir), [])
    })

    /**
     * Filters a project whose one member has the given manifest, and expects a throw.
     * @param {string} memberJson The member's package.json content.
     * @param {RegExp} reason What the message carries after the member's directory.
     * @returns {void}
     */
    function assertMemberRefused(memberJson: string, reason: RegExp): void {
      const dir = project({
        'package.json': { devDependencies: { bare: '^1' }, workspaces: ['packages/*'] },
        'packages/a/package.json': memberJson
      })
      const prefix = `--no-dev needs a readable package.json in ${join(dir, 'packages', 'a')}`
      assert.throws(
        () => kept(['bare@1.0.0'], content, 'yarn-classic', dir),
        (err: Error) =>
          err.message.startsWith(prefix) && reason.test(err.message.slice(prefix.length))
      )
    }

    // Regression: the member was skipped, so what only it needs looked dev-only.
    it('refuses a member whose manifest cannot be parsed, as the CLI does the root', () => {
      assertMemberRefused('{ not json', /^: ./u)
    })

    it('refuses a member whose manifest is null', () => {
      assertMemberRefused('null', /^$/u)
    })

    it('reads an object with no packages as no members', () => {
      const dir = project({
        'package.json': { devDependencies: { bare: '^1' }, workspaces: {} },
        'packages/a/package.json': { dependencies: { bare: '^1' } }
      })
      assert.deepStrictEqual(kept(['bare@1.0.0'], content, 'yarn-classic', dir), [])
    })

    it('reads the patterns under packages in an object', () => {
      const dir = project({
        'package.json': {
          devDependencies: { bare: '^1' },
          workspaces: { packages: ['packages/*'] }
        },
        'packages/a/package.json': { dependencies: { bare: '^1' } }
      })
      assert.deepStrictEqual(kept(['bare@1.0.0'], content, 'yarn-classic', dir), ['bare@1.0.0'])
    })

    // Regression: package.json was cast to its type unchecked, so a string where the
    // pattern list belongs crashed with a TypeError, or read as no workspaces.
    for (const [label, workspaces] of [
      ['a string under packages', { packages: 'packages/*' }],
      ['a string', 'packages/*'],
      ['a list holding a non-string', ['packages/*', 5]]
    ] as const) {
      it(`refuses ${label} as the workspaces field`, () => {
        const dir = project({ 'package.json': { workspaces } })
        assert.throws(
          () => kept(['bare@1.0.0'], content, 'yarn-classic', dir),
          (err: unknown) =>
            !(err instanceof TypeError) &&
            String(err).includes(
              `--no-dev cannot read the workspaces field of ${join(dir, 'package.json')}`
            )
        )
      })
    }
  })

  describe('peers', () => {
    const content = [
      entry('host@^1', '1.0.0'),
      entry('react@^18', '18.3.1', '  dependencies:\n    loose "^1"\n'),
      entry('react-dom@^18', '18.3.1'),
      entry('loose@^1', '1.4.0')
    ].join('\n')
    const dir = (): string =>
      project({
        'package.json': {
          dependencies: { host: '^1' },
          devDependencies: { react: '^18', 'react-dom': '^18' }
        }
      })

    // yarn install --production does this: it adds a resolved peer as a real dependency.
    it('keeps a dev root that a production package peers on, and what it needs', () => {
      const packages: Package[] = [
        { name: 'host', version: '1.0.0', peerDependencies: { react: '^18' } },
        { name: 'react', version: '18.3.1' },
        { name: 'react-dom', version: '18.3.1' },
        { name: 'loose', version: '1.4.0' }
      ]
      assert.deepStrictEqual(
        filterDevPackages(packages, dir(), content, 'yarn-classic').map(p => p.name),
        ['host', 'react', 'loose']
      )
    })

    it('does not apply when no production package names the peer', () => {
      const all = ['host@1.0.0', 'react@18.3.1', 'react-dom@18.3.1', 'loose@1.4.0']
      assert.deepStrictEqual(kept(all, content, 'yarn-classic', dir()), ['host@1.0.0'])
    })
  })
})

describe('filterDevPackages on yarn berry lockfiles', () => {
  const lockOf = (...entries: string[]): string =>
    `__metadata:\n  version: 8\n\n${entries.join('\n')}`
  const entry = (key: string, version: string, deps: Record<string, string> = {}): string => {
    const lines = Object.entries(deps).map(([name, range]) => `    ${name}: "${range}"`)
    const block = lines.length > 0 ? `  dependencies:\n${lines.join('\n')}\n` : ''
    return `"${key}":\n  version: ${version}\n${block}`
  }
  const workspace = (name: string, path: string, deps: Record<string, string>): string => {
    const block = Object.entries(deps)
      .map(([dep, range]) => `    ${dep}: "${range}"`)
      .join('\n')
    const descriptor = `${name}@workspace:${path}`
    return (
      `"${descriptor}":\n  version: 0.0.0-use.local\n  resolution: "${descriptor}"\n` +
      `  dependencies:\n${block}\n`
    )
  }

  it('sorts a workspace entry by package.json, because it merges dev dependencies', () => {
    const content = lockOf(
      workspace('root', '.', { prod: 'npm:^1', tool: 'npm:^1' }),
      entry('prod@npm:^1', '1.0.0', { shared: 'npm:^1' }),
      entry('tool@npm:^1', '1.0.0', { shared: 'npm:^1', transitive: 'npm:^1' }),
      entry('shared@npm:^1', '1.0.0'),
      entry('transitive@npm:^1', '1.0.0')
    )
    const dir = project({
      'package.json': { dependencies: { prod: '^1' }, devDependencies: { tool: '^1' } }
    })
    const all = ['prod@1.0.0', 'shared@1.0.0', 'tool@1.0.0', 'transitive@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'yarn-berry', dir), ['prod@1.0.0', 'shared@1.0.0'])
  })

  it('matches ranges written without npm:, as before Yarn 4', () => {
    const content = lockOf(
      workspace('root', '.', { tool: '^1' }),
      entry('tool@npm:^1', '1.0.0', { inner: '^1' }),
      entry('inner@npm:^1', '1.0.0')
    )
    const dir = project({ 'package.json': { devDependencies: { tool: '^1' } } })
    assert.deepStrictEqual(kept(['tool@1.0.0', 'inner@1.0.0'], content, 'yarn-berry', dir), [])
  })

  it('reads each member package.json from the path in its resolution', () => {
    const content = lockOf(
      workspace('@me/a', 'packages/a', { ms: 'npm:^2', debug: 'npm:^4' }),
      entry('ms@npm:^2', '2.1.3'),
      entry('debug@npm:^4', '4.3.7')
    )
    const dir = project({
      'packages/a/package.json': { dependencies: { ms: '^2' }, devDependencies: { debug: '^4' } }
    })
    assert.deepStrictEqual(kept(['ms@2.1.3', 'debug@4.3.7'], content, 'yarn-berry', dir), [
      'ms@2.1.3'
    ])
  })

  it('treats a dependency listed as dev and production or optional as production', () => {
    const content = lockOf(
      workspace('root', '.', { both: 'npm:^1', opt: 'npm:^1' }),
      entry('both@npm:^1', '1.0.0'),
      entry('opt@npm:^1', '1.0.0')
    )
    const dir = project({
      'package.json': {
        dependencies: { both: '^1' },
        optionalDependencies: { opt: '^1' },
        devDependencies: { both: '^1', opt: '^1' }
      }
    })
    const all = ['both@1.0.0', 'opt@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'yarn-berry', dir), all)
  })

  // Regression: an unusable member manifest made every dependency production with
  // no message, so --no-dev kept that member's dev constraints.
  it('refuses a workspace whose package.json is missing', () => {
    const content = lockOf(
      workspace('root', '.', { tool: 'npm:^1' }),
      entry('tool@npm:^1', '1.0.0')
    )
    const dir = project()
    assert.throws(
      () => kept(['tool@1.0.0'], content, 'yarn-berry', dir),
      new RegExp(`^Error: --no-dev needs a readable package\\.json in ${dir}$`, 'u')
    )
  })

  it('refuses a workspace member whose package.json cannot be parsed', () => {
    const content = lockOf(
      workspace('root', '.', {}),
      workspace('m', 'packages/m', { a: 'npm:^1', d: 'npm:^1' }),
      entry('a@npm:^1', '1.0.0'),
      entry('d@npm:^1', '1.0.0')
    )
    const dir = project({
      'package.json': { workspaces: ['packages/*'] },
      'packages/m/package.json': '{"dependencies":{"a":"^1"},"devDependencies":{"d":"^1"}'
    })
    const prefix = `--no-dev needs a readable package.json in ${join(dir, 'packages', 'm')}: `
    assert.throws(
      () => kept(['a@1.0.0', 'd@1.0.0'], content, 'yarn-berry', dir),
      (err: Error) => err.message.startsWith(prefix)
    )
  })

  it('tells versions of one package apart by descriptor', () => {
    const content = lockOf(
      workspace('root', '.', { foo: 'npm:^1', tool: 'npm:^1' }),
      entry('foo@npm:^1', '1.0.0'),
      entry('foo@npm:^2', '2.0.0'),
      entry('tool@npm:^1', '1.0.0', { foo: 'npm:^2' })
    )
    const dir = project({
      'package.json': { dependencies: { foo: '^1' }, devDependencies: { tool: '^1' } }
    })
    assert.deepStrictEqual(kept(['foo@1.0.0', 'foo@2.0.0'], content, 'yarn-berry', dir), [
      'foo@1.0.0'
    ])
  })

  it('finds every descriptor of a merged key and credits the real package', () => {
    const content = lockOf(
      workspace('root', '.', { nick: 'npm:real@^1' }),
      '"nick@npm:real@^1, real@npm:^1":\n  version: 1.0.0\n  resolution: "real@npm:1.0.0"\n'
    )
    const dir = project({ 'package.json': { devDependencies: { nick: 'npm:real@^1' } } })
    assert.deepStrictEqual(kept(['real@1.0.0'], content, 'yarn-berry', dir), [])
  })

  it('does not treat a workspace dependency as a package', () => {
    const content = lockOf(
      workspace('root', '.', { sibling: 'workspace:*' }),
      '"sibling@workspace:*, sibling@workspace:packages/sibling":\n' +
        '  version: 0.0.0-use.local\n  resolution: "sibling@workspace:packages/sibling"\n'
    )
    const dir = project({
      'package.json': { devDependencies: { sibling: 'workspace:*' } },
      'packages/sibling/package.json': {}
    })
    assert.deepStrictEqual(kept(['sibling@0.0.0-use.local'], content, 'yarn-berry', dir), [
      'sibling@0.0.0-use.local'
    ])
  })

  // Regression: debug still asks for ms 2.1.2, which the lockfile no longer has.
  it('follows a dependency that resolutions pinned to another version', () => {
    const content = lockOf(
      workspace('root', '.', { debug: 'npm:4.3.4', send: 'npm:0.18.0' }),
      entry('debug@npm:4.3.4', '4.3.4', { ms: 'npm:2.1.2' }),
      entry('ms@npm:2.1.3', '2.1.3'),
      entry('send@npm:0.18.0', '0.18.0', { ms: 'npm:2.1.3' })
    )
    const dir = project({
      'package.json': {
        dependencies: { debug: '4.3.4' },
        devDependencies: { send: '0.18.0' },
        resolutions: { ms: '2.1.3' }
      }
    })
    const all = ['debug@4.3.4', 'ms@2.1.3', 'send@0.18.0']
    assert.deepStrictEqual(kept(all, content, 'yarn-berry', dir), ['debug@4.3.4', 'ms@2.1.3'])
  })

  // Regression: their keys end in the declaring workspace's locator, so the walk stopped there.
  it('follows file: and portal: dependencies to what they depend on', () => {
    const locator = '::locator=root%40workspace%3A.'
    const content = lockOf(
      workspace('root', '.', { local: 'file:./local', portaled: 'portal:./portaled', tool: '^1' }),
      entry(`local@file:./local${locator}`, '1.0.0', { ms: 'npm:2.1.2' }),
      entry(`portaled@portal:./portaled${locator}`, '0.0.0-use.local', { debug: 'npm:2.6.9' }),
      entry('debug@npm:2.6.9', '2.6.9'),
      entry('ms@npm:2.1.2', '2.1.2'),
      entry('tool@npm:^1', '1.0.0', { debug: 'npm:2.6.9', ms: 'npm:2.1.2' })
    )
    const dir = project({
      'package.json': {
        dependencies: { local: 'file:./local', portaled: 'portal:./portaled' },
        devDependencies: { tool: '^1' }
      }
    })
    const all = ['debug@2.6.9', 'ms@2.1.2', 'tool@1.0.0']
    assert.deepStrictEqual(kept(all, content, 'yarn-berry', dir), ['debug@2.6.9', 'ms@2.1.2'])
  })
})
