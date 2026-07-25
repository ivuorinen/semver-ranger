import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import semver from 'semver'
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

describe('computeIntersection semantics', () => {
  const SAMPLE = [
    '0.9.0',
    '14.0.0',
    '15.1.0',
    '16.5.0',
    '17.5.0',
    '18.0.0',
    '18.2.0',
    '19.0.0',
    '20.1.0',
    '22.3.0'
  ]

  /**
   * Asserts the computed intersection admits exactly the versions that satisfy
   * every input range — no more, no less.
   * @param {string[]} inputRanges Range strings to intersect.
   * @returns {void}
   */
  function assertExact(inputRanges: string[]): void {
    const entries = inputRanges.map((range, i) => ({
      package: `p${String(i)}`,
      version: '1.0.0',
      range
    }))
    const { intersection } = computeIntersection(entries)
    for (const v of SAMPLE) {
      const truth = inputRanges.every(r => semver.satisfies(v, r))
      const reported = intersection !== null && semver.satisfies(v, intersection)
      assert.strictEqual(
        reported,
        truth,
        `${v} against ${JSON.stringify(inputRanges)} -> ${JSON.stringify(intersection)}`
      )
    }
  }

  // Regression: ranges were previously combined by string concatenation, which
  // is wrong because "||" binds looser than the space (AND) operator.
  it('intersects OR-ranges without corrupting precedence', () => {
    assertExact(['^17 || ^18', '^16 || ^18'])
  })

  it('intersects multi-branch OR-ranges', () => {
    assertExact(['^14 || ^16 || ^18', '^16 || ^18 || ^20'])
  })

  it('intersects OR-ranges mixed with plain comparators', () => {
    assertExact(['>=14', '^16 || ^18 || ^20', '>=18'])
  })

  it('narrows across three successive OR-ranges', () => {
    assertExact(['^18 || ^20 || ^22', '^20 || ^22', '^22'])
  })

  it('collapses subsumed comparators to the tightest bound', () => {
    assertExact(['>=18', '>=18.2.0'])
    const { intersection } = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=18' },
      { package: 'b', version: '1.0.0', range: '>=18.2.0' }
    ])
    assert.strictEqual(intersection, '>=18.2.0')
  })

  it('reports disjoint OR-ranges as a conflict rather than a bogus range', () => {
    const { intersection, conflicts } = computeIntersection([
      { package: 'a', version: '1.0.0', range: '^14 || ^16' },
      { package: 'b', version: '1.0.0', range: '^18 || ^20' }
    ])
    assert.strictEqual(intersection, null)
    assert.strictEqual(conflicts.length, 1)
  })

  it('never emits an unsatisfiable OR-group', () => {
    const { intersection } = computeIntersection([
      { package: 'a', version: '1.0.0', range: '^14 || ^16 || ^18' },
      { package: 'b', version: '1.0.0', range: '^16 || ^18 || ^20' }
    ])
    assert.ok(intersection !== null)
    for (const group of intersection.split('||')) {
      assert.notStrictEqual(
        semver.minVersion(group.trim()),
        null,
        `unsatisfiable group emitted: ${group}`
      )
    }
  })

  // Regression: the greedy pass seeded on the lowest minimum version, and a
  // seed is accepted by construction, so the sole outlier could never be
  // named — the report blamed the packages that actually agreed.
  it('names the outlier, not the packages that agree with each other', () => {
    const entries = [
      { package: '@testing-library/react', version: '16.3.0', range: '^18.0.0 || ^19.0.0' },
      { package: 'react-dom', version: '19.1.0', range: '^19.1.0' },
      { package: 'some-legacy-lib', version: '3.0.0', range: '^16.0.0 || ^17.0.0' }
    ]
    const { intersection, conflicts } = computeIntersection(entries)
    assert.strictEqual(intersection, null)
    assert.deepStrictEqual(
      conflicts.map(c => c.package),
      ['some-legacy-lib']
    )
  })

  it('reports the same conflicts regardless of input order', () => {
    const entries = [
      { package: 'a', version: '1.0.0', range: '^18.0.0 || ^19.0.0' },
      { package: 'b', version: '1.0.0', range: '^19.1.0' },
      { package: 'c', version: '1.0.0', range: '^16.0.0 || ^17.0.0' }
    ]
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [0, 2, 1]
    ]
    const results = orders.map(o =>
      computeIntersection(o.map(i => entries[i]))
        .conflicts.map(x => x.package)
        .sort()
        .join(',')
    )
    assert.strictEqual(new Set(results).size, 1, `order-dependent: ${results.join(' | ')}`)
    assert.strictEqual(results[0], 'c')
  })

  it('separates unparseable ranges from genuine conflicts', () => {
    const { intersection, conflicts, invalid } = computeIntersection([
      { package: 'a', version: '1.0.0', range: 'current' },
      { package: 'b', version: '1.0.0', range: 'please-use-yarn' }
    ])
    assert.strictEqual(intersection, null)
    assert.strictEqual(conflicts.length, 0)
    assert.deepStrictEqual(
      invalid.map(e => e.package),
      ['a', 'b']
    )
  })

  it('intersects the valid ranges and still reports the invalid ones', () => {
    const { intersection, invalid } = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=18' },
      { package: 'b', version: '1.0.0', range: 'garbage' }
    ])
    assert.strictEqual(intersection, '>=18.0.0')
    assert.deepStrictEqual(
      invalid.map(e => e.package),
      ['b']
    )
  })
})
