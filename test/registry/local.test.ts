import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before, after } from 'node:test'
import { resolveLocal } from '../../src/registry/local.ts'

const tmpBase = mkdtempSync(join(tmpdir(), 'semver-ranger-local-'))

after(() => {
  rmSync(tmpBase, { recursive: true, force: true })
})

describe('resolveLocal', () => {
  before(() => {
    mkdirSync(join(tmpBase, 'node_modules/express'), { recursive: true })
    writeFileSync(
      join(tmpBase, 'node_modules/express/package.json'),
      JSON.stringify({
        name: 'express',
        version: '4.18.2',
        engines: { node: '>= 0.10.0' },
        peerDependencies: { 'some-peer': '^1.0.0' }
      })
    )
    mkdirSync(join(tmpBase, 'node_modules/@types/node'), { recursive: true })
    writeFileSync(
      join(tmpBase, 'node_modules/@types/node/package.json'),
      JSON.stringify({ name: '@types/node', version: '20.0.0', engines: { node: '>=20' } })
    )
  })

  it('resolves engines and peerDependencies from node_modules', () => {
    const result = resolveLocal([{ name: 'express', version: '4.18.2' }], tmpBase)
    assert.strictEqual(result[0].engines?.node, '>= 0.10.0')
    assert.strictEqual(result[0].peerDependencies?.['some-peer'], '^1.0.0')
    assert.strictEqual(result[0].hasMetadata, true)
  })

  it('leaves a package that is not installed unchanged', () => {
    const missing = { name: 'missing-pkg', version: '1.0.0' }
    assert.deepStrictEqual(resolveLocal([missing], tmpBase), [missing])
  })

  it('resolves scoped packages', () => {
    const result = resolveLocal([{ name: '@types/node', version: '20.0.0' }], tmpBase)
    assert.deepStrictEqual(result[0].engines, { node: '>=20' })
  })

  it('keeps lockfile data the installed manifest does not declare', () => {
    const dir = join(tmpBase, 'sparse')
    mkdirSync(join(dir, 'node_modules', 'sparse'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'sparse', 'package.json'), '{"version":"1.0.0"}')
    const engines = { node: '>=1' }
    const peerDependencies = { other: '^2' }
    const [pkg] = resolveLocal(
      [{ name: 'sparse', version: '1.0.0', engines, peerDependencies }],
      dir
    )
    assert.deepStrictEqual(pkg.engines, engines)
    assert.deepStrictEqual(pkg.peerDependencies, peerDependencies)
  })
})

describe('resolveLocal version matching', () => {
  // Regression: node_modules holds one hoisted copy per name, but a lockfile may
  // list several versions — the hoisted manifest must not be applied to all.
  it('does not apply the hoisted manifest to a different version', () => {
    const dir = join(tmpBase, 'hoist')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'foo'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'foo', 'package.json'),
      JSON.stringify({ name: 'foo', version: '3.0.0', engines: { node: '>=20' } })
    )

    const resolved = resolveLocal(
      [
        { name: 'foo', version: '3.0.0' },
        { name: 'foo', version: '1.0.0' }
      ],
      dir
    )

    assert.deepStrictEqual(resolved[0].engines, { node: '>=20' })
    assert.strictEqual(typeof resolved[1].engines, 'undefined')
    rmSync(dir, { recursive: true, force: true })
  })

  it('still applies a manifest that declares no version', () => {
    const dir = join(tmpBase, 'nover')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'bar'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'bar', 'package.json'),
      JSON.stringify({ name: 'bar', engines: { node: '>=18' } })
    )

    const resolved = resolveLocal([{ name: 'bar', version: '1.0.0' }], dir)
    assert.deepStrictEqual(resolved[0].engines, { node: '>=18' })
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveLocal aliases', () => {
  it('reads an aliased package from the directory it is installed under', () => {
    const dir = join(tmpBase, 'alias')
    mkdirSync(join(dir, 'node_modules', 'nick'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'nick', 'package.json'),
      JSON.stringify({ version: '1.0.0', engines: { node: '>=20' } })
    )
    const [pkg] = resolveLocal([{ name: 'real', version: '1.0.0', alias: 'nick' }], dir)
    assert.deepStrictEqual(pkg.engines, { node: '>=20' })
    assert.strictEqual(pkg.hasMetadata, true)
  })
})
