import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, before, after } from 'node:test'
import { resolveLocal } from '../../src/registry/local.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const tmpBase = join(currentDir, '../../.tmp-local-test')

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
      JSON.stringify({ name: '@types/node', version: '20.0.0' })
    )
  })

  after(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  it('resolves engines and peerDependencies from node_modules', async () => {
    const result = await resolveLocal([{ name: 'express', version: '4.18.2' }], tmpBase)
    assert.strictEqual(result[0].engines?.node, '>= 0.10.0')
    assert.ok(result[0].peerDependencies?.['some-peer'])
  })

  it('handles missing packages gracefully', async () => {
    const result = await resolveLocal([{ name: 'missing-pkg', version: '1.0.0' }], tmpBase)
    assert.ok(typeof result[0].engines === 'undefined')
  })

  it('resolves scoped packages', async () => {
    const result = await resolveLocal([{ name: '@types/node', version: '20.0.0' }], tmpBase)
    assert.ok(result[0])
  })
})

describe('resolveLocal version matching', () => {
  // Regression: node_modules holds one hoisted copy per name, but a lockfile may
  // list several versions — the hoisted manifest must not be applied to all.
  it('does not apply the hoisted manifest to a different version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semver-ranger-hoist-'))
    mkdirSync(join(dir, 'node_modules', 'foo'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'foo', 'package.json'),
      JSON.stringify({ name: 'foo', version: '3.0.0', engines: { node: '>=20' } })
    )

    const resolved = await resolveLocal(
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

  it('still applies a manifest that declares no version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semver-ranger-nover-'))
    mkdirSync(join(dir, 'node_modules', 'bar'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'bar', 'package.json'),
      JSON.stringify({ name: 'bar', engines: { node: '>=18' } })
    )

    const resolved = await resolveLocal([{ name: 'bar', version: '1.0.0' }], dir)
    assert.deepStrictEqual(resolved[0].engines, { node: '>=18' })
    rmSync(dir, { recursive: true, force: true })
  })
})
