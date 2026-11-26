import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectPeerTargets, analyzePeers } from '../../src/analyzer/peers.ts'
import { readProjectManifest } from '../../src/parsers/detect.ts'
import type { Package } from '../../src/types.ts'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')
const manifest = readProjectManifest(fixturesDir).deps

describe('detectPeerTargets', () => {
  it('detects typescript from project package.json', () => {
    const targets = detectPeerTargets(manifest, [])
    assert.ok(targets.includes('typescript'))
  })

  it('detects vite from project package.json', () => {
    const targets = detectPeerTargets(manifest, [])
    assert.ok(targets.includes('vite'))
  })

  it('merges --check additions', () => {
    const targets = detectPeerTargets(manifest, ['some-custom-pkg'])
    assert.ok(targets.includes('some-custom-pkg'))
  })

  it('returns extraChecks when the project has no package.json', () => {
    const result = detectPeerTargets(null, ['custom-pkg'])
    assert.deepStrictEqual(result, ['custom-pkg'])
  })

  it('leaves out well-known packages the project does not declare', () => {
    const result = detectPeerTargets({ dependencies: { react: '^18.0.0' } }, [])
    assert.deepStrictEqual(result, ['react'])
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

  it('populates latestRanges from the latest peerDependencies', () => {
    const packages: Package[] = [
      {
        name: 'some-lib',
        version: '1.0.0',
        peerDependencies: { react: '>=16' },
        latest: { version: '2.0.0', peerDependencies: { react: '>=18' } }
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

  // Regression: --check constructor read Object's constructor from every
  // peerDependencies object and listed it as an unparseable range.
  it('ignores inherited members when the target shares their name', () => {
    const packages: Package[] = [
      {
        name: 'a',
        version: '1.0.0',
        peerDependencies: { react: '^18' },
        latest: { version: '2.0.0', peerDependencies: { react: '^19' } }
      }
    ]
    assert.deepStrictEqual(analyzePeers(packages, ['constructor', 'toString']), [])
  })

  it('reads a declared peer whose name is an Object member', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', peerDependencies: { constructor: '^1.2.0' } }
    ]
    const [target] = analyzePeers(packages, ['constructor'])
    assert.deepStrictEqual(target?.ranges, [{ package: 'a', version: '1.0.0', range: '^1.2.0' }])
  })

  it('skips wildcard peer dependency ranges', () => {
    const packages: Package[] = [{ name: 'a', version: '1.0.0', peerDependencies: { react: '*' } }]
    const result = analyzePeers(packages, ['react'])
    assert.strictEqual(result.length, 0)
  })
})
