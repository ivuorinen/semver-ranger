import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analyzeEngines } from '../../src/analyzer/engines.js'
import type { Package } from '../../src/types.js'

describe('analyzeEngines', () => {
  it('collects node engine constraints', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14.0.0' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const nodeTarget = targets.find(t => t.name === 'node')
    assert.ok(nodeTarget)
    assert.strictEqual(nodeTarget.ranges.length, 2)
    assert.ok(nodeTarget.intersection !== null)
  })

  it('returns null intersection for conflicting ranges', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=14.0.0 <18.0.0' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const nodeTarget = targets.find(t => t.name === 'node')
    assert.ok(nodeTarget)
    assert.strictEqual(nodeTarget.intersection, null)
    assert.ok(nodeTarget.conflicts.length > 0)
  })

  it('ignores packages with no engine constraints', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '>=18.0.0' } },
      { name: 'b', version: '2.0.0' }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const nodeTarget = targets.find(t => t.name === 'node')
    assert.ok(nodeTarget)
    assert.strictEqual(nodeTarget.ranges.length, 1)
  })

  it('skips wildcard engine ranges', () => {
    const packages: Package[] = [
      { name: 'a', version: '1.0.0', engines: { node: '*' } },
      { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const nodeTarget = targets.find(t => t.name === 'node')
    assert.ok(nodeTarget)
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
  })

  it('uses latestEngines for latestRanges', () => {
    const packages: Package[] = [
      {
        name: 'a',
        version: '1.0.0',
        latestVersion: '2.0.0',
        engines: { node: '>=14' },
        latestEngines: { node: '>=18' }
      }
    ]
    const targets = analyzeEngines(packages, 'npm')
    const nodeTarget = targets.find(t => t.name === 'node')
    assert.ok(nodeTarget)
    assert.ok(nodeTarget.latestRanges.length > 0)
    assert.strictEqual(nodeTarget.latestRanges[0].range, '>=18')
  })
})
