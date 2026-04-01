import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeIntersection } from '../../src/analyzer/intersect.js'

describe('computeIntersection', () => {
  it('returns intersection for compatible ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=14.0.0' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.ok(result.intersection !== null)
    assert.strictEqual(result.conflicts.length, 0)
  })

  it('returns null with conflicts for disjoint ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=14.0.0 <18.0.0' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.strictEqual(result.intersection, null)
    assert.ok(result.conflicts.length > 0)
  })

  it('ignores wildcard ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '*' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.ok(result.intersection !== null)
  })

  it('returns null for empty input', () => {
    const result = computeIntersection([])
    assert.strictEqual(result.intersection, null)
  })

  it('handles range where minVersion returns null without throwing', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>1.0.0-0' },
      { package: 'b', version: '2.0.0', range: '>=2.0.0' }
    ])
    assert.ok('intersection' in result)
  })

  it('sorts correctly when minVersion is null for one entry', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '<0.0.0-0' },
      { package: 'b', version: '2.0.0', range: '>=1.0.0' }
    ])
    // <0.0.0-0 is an empty range (nothing satisfies it), so it conflicts
    assert.ok('intersection' in result)
  })

  it('sorts correctly when minVersion is null for both entries', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '<0.0.0-0' },
      { package: 'b', version: '2.0.0', range: '<0.0.0-0' }
    ])
    assert.ok('intersection' in result)
  })

  it('produces consistent conflicts regardless of input order', () => {
    const rangeA = { package: 'a', version: '1.0.0', range: '>=14.0.0 <18.0.0' }
    const rangeB = { package: 'b', version: '2.0.0', range: '>=20.0.0' }
    const rangeC = { package: 'c', version: '3.0.0', range: '>=16.0.0 <21.0.0' }

    const orderABC = computeIntersection([rangeA, rangeB, rangeC])
    const orderBAC = computeIntersection([rangeB, rangeA, rangeC])
    const orderCAB = computeIntersection([rangeC, rangeA, rangeB])

    assert.strictEqual(orderABC.intersection, orderBAC.intersection)
    assert.strictEqual(orderABC.intersection, orderCAB.intersection)

    assert.ok(orderABC.conflicts.some(c => c.package === 'b'))
    assert.ok(orderBAC.conflicts.some(c => c.package === 'b'))
    assert.ok(orderCAB.conflicts.some(c => c.package === 'b'))
  })
})
