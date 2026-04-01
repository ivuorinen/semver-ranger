import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectPeerTargets, analyzePeers } from '../../src/analyzer/peers.js'
import type { Package } from '../../src/types.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('detectPeerTargets', () => {
  it('detects typescript from project package.json', () => {
    const targets = detectPeerTargets(fixturesDir, [])
    assert.ok(targets.includes('typescript'))
  })

  it('detects vite from project package.json', () => {
    const targets = detectPeerTargets(fixturesDir, [])
    assert.ok(targets.includes('vite'))
  })

  it('merges --check additions', () => {
    const targets = detectPeerTargets(fixturesDir, ['some-custom-pkg'])
    assert.ok(targets.includes('some-custom-pkg'))
  })

  it('returns extraChecks when projectDir has no package.json', () => {
    const result = detectPeerTargets('/nonexistent-dir-12345', ['custom-pkg'])
    assert.deepStrictEqual(result, ['custom-pkg'])
  })
})

describe('analyzePeers', () => {
  it('collects peer dependency ranges for a target', () => {
    const packages: Package[] = [
      {
        name: 'react-router',
        version: '6.0.0',
        peerDependencies: { react: '>=16.0.0' }
      },
      {
        name: 'react-query',
        version: '5.0.0',
        peerDependencies: { react: '>=18.0.0' }
      }
    ]
    const targets = analyzePeers(packages, ['react'])
    const reactTarget = targets.find(t => t.name === 'react')
    assert.ok(reactTarget)
    assert.strictEqual(reactTarget.ranges.length, 2)
  })

  it('populates latestRanges from latestPeerDependencies', () => {
    const packages: Package[] = [
      {
        name: 'some-lib',
        version: '1.0.0',
        latestVersion: '2.0.0',
        peerDependencies: { react: '>=16' },
        latestPeerDependencies: { react: '>=18' }
      }
    ]
    const targets = analyzePeers(packages, ['react'])
    assert.strictEqual(targets.length, 1)
    const reactTarget = targets[0]
    assert.strictEqual(reactTarget.latestRanges.length, 1)
    assert.strictEqual(reactTarget.latestRanges[0].range, '>=18')
    assert.strictEqual(reactTarget.latestRanges[0].version, '2.0.0')
  })

  it('returns empty when no packages declare peer', () => {
    const packages: Package[] = [{ name: 'lodash', version: '4.0.0' }]
    const targets = analyzePeers(packages, ['react'])
    assert.strictEqual(targets.length, 0)
  })

  it('skips wildcard peer dependency ranges', () => {
    const packages: Package[] = [{ name: 'a', version: '1.0.0', peerDependencies: { react: '*' } }]
    const result = analyzePeers(packages, ['react'])
    assert.strictEqual(result.length, 0)
  })
})
