import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analyzeEngines } from '../../src/analyzer/engines.ts'
import type { AnalysisTarget, Package } from '../../src/types.ts'

/**
 * Analyzes node engine constraints for the given packages and returns the node target.
 * Asserts that a node target exists.
 * @param {Package[]} packages Packages to analyze.
 * @returns {AnalysisTarget} The node engine analysis target.
 */
function analyzeNode(packages: Package[]): AnalysisTarget {
  const targets = analyzeEngines(packages, 'npm')
  const nodeTarget = targets.find(t => t.name === 'node')
  assert.ok(nodeTarget)
  return nodeTarget
}

describe('analyzeEngines', () => {
  it('collects node engine constraints', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14.0.0' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const nodeTarget = analyzeNode(packages)
    assert.strictEqual(nodeTarget.ranges.length, 2)
    assert.strictEqual(nodeTarget.intersection, '>=18.0.0')
  })

  it('returns null intersection for conflicting ranges', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14.0.0 <18.0.0' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const nodeTarget = analyzeNode(packages)
    assert.strictEqual(nodeTarget.intersection, null)
    assert.deepStrictEqual(
      nodeTarget.conflicts.map(c => c.package),
      ['b']
    )
  })

  it('ignores packages with no engine constraints', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=18.0.0' } },
      { name: 'b', version: '2.0.0' }
    ]
    const nodeTarget = analyzeNode(packages)
    assert.strictEqual(nodeTarget.ranges.length, 1)
  })

  it('skips wildcard engine ranges', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '*' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const nodeTarget = analyzeNode(packages)
    assert.strictEqual(nodeTarget.ranges.length, 1)
    assert.ok(!nodeTarget.ranges.some(r => r.package === 'a'))
  })

  it('includes npm manager constraint when manager is npm', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14', npm: '>=7' } }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const npmTarget = targets.find(t => t.name === 'npm')
    assert.ok(npmTarget)
    assert.strictEqual(npmTarget.source, 'engines')
    assert.strictEqual(npmTarget.intersection, '>=7.0.0')
  })

  it('leaves out the constraints of package managers not in use', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14', npm: '>=7' } }
    ]
    assert.deepStrictEqual(
      analyzeEngines(packages, 'yarn').map(target => target.name),
      ['node']
    )
  })

  it('uses the latest engines for latestRanges', () => {
    const packages: Package[] = [
      {
        name: 'a',
        version: '1.0.0',
        engines: { node: '>=14' },
        latest: { version: '2.0.0', engines: { node: '>=18' } }
      }
    ]
    const nodeTarget = analyzeNode(packages)
    assert.ok(nodeTarget.latestRanges.length > 0)
    assert.strictEqual(nodeTarget.latestRanges[0].range, '>=18')
  })
})

describe('analyzeEngines input handling', () => {
  it('reports a non-string range as unparseable instead of failing', () => {
    const packages = [
      { name: 'a', version: '1.0.0', engines: { node: 18 } }
    ] as unknown as Package[]
    const target = analyzeNode(packages)
    assert.strictEqual(target.intersection, null)
    assert.deepStrictEqual(
      target.invalidRanges.map(entry => entry.range),
      ['not a string: 18']
    )
  })

  it('collects latest data once per package name', () => {
    const latest = { version: '3.0.0', engines: { node: '<10' } }
    const target = analyzeNode([
      { name: 'a', version: '1.0.0', latest },
      { name: 'a', version: '2.0.0', latest }
    ])
    assert.strictEqual(target.latestRanges.length, 1)
  })

  it('reports the latest version on latest entries', () => {
    const target = analyzeNode([
      { name: 'a', version: '1.0.0', latest: { version: '3.0.0', engines: { node: '>=20' } } }
    ])
    assert.strictEqual(target.latestRanges[0].version, '3.0.0')
  })
})
