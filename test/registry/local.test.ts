import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
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
