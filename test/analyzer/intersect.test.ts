import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import semver from 'semver'
import { computeIntersection } from '../../src/analyzer/intersect.ts'

describe('computeIntersection', () => {
  it('returns intersection for compatible ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=14.0.0' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.strictEqual(result.intersection, '>=18.0.0')
    assert.strictEqual(result.conflicts.length, 0)
  })

  it('returns null with conflicts for disjoint ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>=14.0.0 <18.0.0' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.strictEqual(result.intersection, null)
    assert.deepStrictEqual(
      result.conflicts.map(c => c.package),
      ['b']
    )
  })

  it('ignores wildcard ranges', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '*' },
      { package: 'b', version: '2.0.0', range: '>=18.0.0' }
    ])
    assert.strictEqual(result.intersection, '>=18.0.0')
  })

  it('returns null for empty input', () => {
    const result = computeIntersection([])
    assert.strictEqual(result.intersection, null)
    assert.deepStrictEqual(result.conflicts, [])
  })

  it('keeps a comparator it has no rule for merging', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '>1.0.0' },
      { package: 'b', version: '2.0.0', range: '>=2.0.0' }
    ])
    assert.strictEqual(result.intersection, '>=2.0.0 >1.0.0')
  })

  // <0.0.0-0 is an empty range: nothing satisfies it, so it is always the culprit.
  it('blames an unsatisfiable range whichever order it arrives in', () => {
    const impossible = { package: 'a', version: '1.0.0', range: '<0.0.0-0' }
    const fine = { package: 'b', version: '2.0.0', range: '>=1.0.0' }
    for (const order of [
      [impossible, fine],
      [fine, impossible]
    ]) {
      const result = computeIntersection(order)
      assert.strictEqual(result.intersection, null)
      assert.deepStrictEqual(
        result.conflicts.map(c => c.package),
        ['a']
      )
    }
  })

  it('finds no range when every entry is unsatisfiable', () => {
    const result = computeIntersection([
      { package: 'a', version: '1.0.0', range: '<0.0.0-0' },
      { package: 'b', version: '2.0.0', range: '<0.0.0-0' }
    ])
    assert.strictEqual(result.intersection, null)
    assert.deepStrictEqual(result.conflicts.map(c => c.package).toSorted(), ['a', 'b'])
  })

  it('reports any-version ranges not written as * as unconstrained', () => {
    for (const range of ['x', '']) {
      const result = computeIntersection([{ package: 'a', version: '1.0.0', range }])
      assert.strictEqual(result.intersection, '*')
      assert.deepStrictEqual(result.invalid, [])
    }
  })

  it('produces consistent conflicts regardless of input order', () => {
    const rangeA = { package: 'a', version: '1.0.0', range: '>=14.0.0 <18.0.0' }
    const rangeB = { package: 'b', version: '2.0.0', range: '>=20.0.0' }
    const rangeC = { package: 'c', version: '3.0.0', range: '>=16.0.0 <21.0.0' }

    const orderABC = computeIntersection([rangeA, rangeB, rangeC])
    const orderBAC = computeIntersection([rangeB, rangeA, rangeC])
    const orderCAB = computeIntersection([rangeC, rangeA, rangeB])

    for (const result of [orderABC, orderBAC, orderCAB]) {
      assert.strictEqual(result.intersection, null)
      assert.deepStrictEqual(
        result.conflicts.map(c => c.package),
        ['b']
      )
    }
  })

  // Regression: entries with equal minimums kept their input order, and that
  // chose the first seed, so swapping two packages changed who was blamed.
  it('produces the same conflicts when minimum versions tie', () => {
    const one = { package: 's1', version: '1.0.0', range: '>=1 <3' }
    const two = { package: 's2', version: '1.0.0', range: '>=1 <2 || >=4 <5' }
    const rest = ['t1', 't2', 't3'].map(name => ({
      package: name,
      version: '1.0.0',
      range: '>=2.5 <6'
    }))
    const blamed = (entries: typeof rest) =>
      computeIntersection(entries).conflicts.map(c => c.package)
    assert.deepStrictEqual(blamed([one, two, ...rest]), blamed([two, one, ...rest]))
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
    '22.3.0',
    '2.0.0-alpha',
    '2.0.0-beta',
    '2.0.0',
    '2.5.0-rc',
    '2.5.0',
    '3.0.0-alpha',
    '3.0.0-rc.1',
    '3.0.0',
    '18.0.0-rc.1'
  ]

  /**
   * Asserts that, among the sampled versions, the computed intersection admits
   * exactly those that satisfy every input range.
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

  describe('prereleases', () => {
    /**
     * Intersects ranges.
     * @param {string[]} inputRanges Range strings to intersect.
     * @returns {string | null} The intersection.
     */
    function intersect(inputRanges: string[]): string | null {
      return computeIntersection(
        inputRanges.map((range, i) => ({ package: `p${String(i)}`, version: '1.0.0', range }))
      ).intersection
    }

    // Regression: the merged range admitted 2.0.0-beta, which >=1.0.0 rejects.
    it('does not let one side grant prereleases the other withholds', () => {
      assert.strictEqual(intersect(['^2.0.0-alpha', '>=1.0.0']), '>=2.0.0 <3.0.0-0')
    })

    it('keeps prereleases of a release that both sides allow', () => {
      assert.strictEqual(intersect(['^2.0.0-alpha', '^2.0.0-beta']), '>=2.0.0-beta <3.0.0-0')
    })

    it('restates an upper bound to exclude the prereleases of its release', () => {
      assert.strictEqual(intersect(['<3.0.0-rc', '>=1.0.0 <4.0.0']), '>=1.0.0 <3.0.0-0')
      assert.strictEqual(intersect(['<=3.0.0-rc', '>=1.0.0 <4.0.0']), '>=1.0.0 <3.0.0-0')
    })

    it('restates an exclusive lower bound to the release itself', () => {
      assert.strictEqual(intersect(['>2.0.0-alpha', '>=1.0.0']), '>=2.0.0')
    })

    it('rejects an exact prerelease the other side does not allow', () => {
      assert.strictEqual(intersect(['2.0.0-alpha', '>=1.0.0']), null)
    })

    it('keeps an exact prerelease both sides allow', () => {
      assert.strictEqual(intersect(['2.0.0-alpha', '2.0.0-alpha']), '2.0.0-alpha')
    })

    it('drops a branch that only prereleases could satisfy', () => {
      assert.strictEqual(intersect(['2.0.0-alpha || ^3.0.0', '>=1.0.0']), '>=3.0.0 <4.0.0-0')
      assert.strictEqual(intersect(['>=2.0.0-alpha <2.0.0', '>=1.0.0']), null)
    })

    it('stays exact against sampled prereleases', () => {
      assertExact(['^2.0.0-alpha', '>=1.0.0'])
      assertExact(['^2.0.0-alpha', '^2.0.0-beta'])
      assertExact(['>=2.0.0-alpha <3.0.0-rc.1', '>=2.0.0-beta <3.0.0-rc.5'])
      assertExact(['<3.0.0-rc', '>=2.0.0 <4.0.0'])
      assertExact(['>2.0.0-alpha', '>=1.0.0'])
      assertExact(['2.0.0-alpha || ^3.0.0', '>=1.0.0'])
      assertExact(['^18.0.0-rc.1', '^18', '>=14'])
    })

    it('applies across more than two ranges', () => {
      assert.strictEqual(intersect(['^2.0.0-alpha', '^2.0.0-beta', '>=1.0.0']), '>=2.0.0 <3.0.0-0')
    })
  })

  it('leaves a range without bounds unchanged when intersecting a prerelease', () => {
    assert.strictEqual(
      computeIntersection([
        { package: 'a', version: '1.0.0', range: '>=1.0.0 || >=0.0.0' },
        { package: 'b', version: '1.0.0', range: '^2.0.0-alpha' }
      ]).intersection,
      '>=2.0.0 <3.0.0-0'
    )
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

  // Regression: seeding only from the first pass's conflicts, capped at a
  // fixed count, could miss the largest agreeing group entirely. With one low
  // outlier, eight mid entries and nine high ones, the cap never reached the
  // high group and the nine agreeing entries were reported as the conflict.
  it('finds the largest agreeing group beyond the first few candidates', () => {
    const entries = [
      { package: 'low-1', version: '1.0.0', range: '>=0.0.0 <1.0.0' },
      ...Array.from({ length: 8 }, (_, i) => ({
        package: `mid-${String(i + 1)}`,
        version: '1.0.0',
        range: '>=2.0.0 <3.0.0'
      })),
      ...Array.from({ length: 9 }, (_, i) => ({
        package: `high-${String(i + 1)}`,
        version: '1.0.0',
        range: '>=10.0.0 <11.0.0'
      }))
    ]
    const { intersection, conflicts } = computeIntersection(entries)
    assert.strictEqual(intersection, null)
    // The nine "high" entries agree with each other, so they are the group to
    // keep; everything else is the outlier set.
    assert.strictEqual(conflicts.length, 9)
    assert.ok(
      conflicts.every(c => c.package.startsWith('low-') || c.package.startsWith('mid-')),
      `blamed an agreeing entry: ${conflicts.map(c => c.package).join(', ')}`
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

describe('computeIntersection bounds and growth', () => {
  const entry = (range: string, name = 'a') => ({ package: name, version: '1.0.0', range })

  it('keeps the lowest upper bound', () => {
    const { intersection } = computeIntersection([entry('<3.0.0', 'a'), entry('<2.0.0', 'b')])
    assert.strictEqual(intersection, '<2.0.0')
  })

  it('keeps the highest lower bound', () => {
    const { intersection } = computeIntersection([entry('>=1.0.0', 'a'), entry('>=2.0.0', 'b')])
    assert.strictEqual(intersection, '>=2.0.0')
  })

  it('reports a lone unsatisfiable range as a conflict', () => {
    const result = computeIntersection([entry('>=18 <16')])
    assert.strictEqual(result.intersection, null)
    assert.strictEqual(result.conflicts.length, 1)
  })

  // Regression: ties were broken with localeCompare, whose order follows the
  // user's locale. English collation puts `alpha` before `Alpha`; code units, the
  // same everywhere, put `A` first.
  it('orders entries with equal minimums by code unit, whatever the locale', () => {
    const result = computeIntersection([
      entry('>=20', 'm1'),
      entry('>=20', 'm2'),
      entry('>=20', 'm3'),
      entry('<1.0.0-alpha', 'lower'),
      entry('<1.0.0-Alpha', 'upper')
    ])
    assert.deepStrictEqual(
      result.conflicts.map(conflict => conflict.package),
      ['upper', 'lower']
    )
  })

  // Regression: semver.minVersion tests only the lowest OR-group's candidate, so a
  // dead lowest group made a lone, satisfiable seed look unsatisfiable.
  it('reports a lone range with one dead OR-group by its live groups', () => {
    const result = computeIntersection([entry('>=20.0.0 <18.0.0 || >=22.0.0')])
    assert.deepStrictEqual(result, { intersection: '>=22.0.0', conflicts: [], invalid: [] })
  })

  it('gives every entry with the same range, however spelled, the same verdict', () => {
    // Verdicts are decided once per normalized range in each seed run.
    const result = computeIntersection([
      entry('<10', 'low1'),
      entry('>=12 <14', 'mid'),
      entry('< 10.0.0', 'low2'),
      entry('>=20', 'hi1'),
      entry('>= 20.0.0', 'hi2'),
      entry('>=20', 'hi3')
    ])
    assert.strictEqual(result.intersection, null)
    assert.deepStrictEqual(result.conflicts.map(c => c.package).sort(), ['low1', 'low2', 'mid'])
  })

  it('treats a wildcard as no constraint', () => {
    assert.strictEqual(computeIntersection([entry('*')]).intersection, null)
  })

  // Regression: overlapping groups all survived, doubling the range per package.
  it('does not grow with repeated overlapping OR-groups', { timeout: 5000 }, () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry('>=4 || >=6', `p${i}`))
    assert.strictEqual(computeIntersection(entries).intersection, '>=4.0.0 || >=6.0.0')
  })
})
