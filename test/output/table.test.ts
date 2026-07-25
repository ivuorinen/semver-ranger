import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderOutput } from '../../src/output/table.js'
import type { AnalysisTarget, Package } from '../../src/types.js'

describe('renderOutput', () => {
  const targets: AnalysisTarget[] = [
    {
      name: 'node',
      source: 'engines',
      ranges: [
        { package: 'express', version: '4.18.2', range: '>=14.0.0' },
        { package: 'typescript', version: '5.0.4', range: '>=12.20' }
      ],
      intersection: '>=14.0.0',
      conflicts: [],
      latestRanges: [{ package: 'express', version: '5.0.0', range: '>=18.0.0' }],
      latestIntersection: '>=18.0.0',
      latestConflicts: [],
      invalidRanges: [],
      latestInvalidRanges: []
    }
  ]

  it('returns a non-empty string', () => {
    const output = renderOutput(targets, 247, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.length > 0)
    assert.ok(output.includes('node'))
  })

  it('json mode returns valid JSON array', () => {
    const output = renderOutput(targets, 247, [], 'package-lock.json', 'npm', false, true)
    const parsed = JSON.parse(output)
    assert.ok(Array.isArray(parsed))
    assert.strictEqual(parsed[0].name, 'node')
  })

  it('shows conflict warning when conflicts exist', () => {
    const conflicting: AnalysisTarget[] = [
      {
        ...targets[0],
        intersection: null,
        conflicts: [{ package: 'legacy-pkg', version: '1.0.0', range: '<18.0.0' }]
      }
    ]
    const output = renderOutput(conflicting, 10, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.includes('legacy-pkg'))
  })

  it('shows latestConflicts warning when latestConflicts exist', () => {
    const conflictingLatest: AnalysisTarget[] = [
      {
        ...targets[0],
        latestIntersection: null,
        latestConflicts: [{ package: 'old-pkg', version: '2.0.0', range: '<20.0.0' }],
        invalidRanges: [],
        latestInvalidRanges: []
      }
    ]
    const output = renderOutput(conflictingLatest, 10, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.includes('old-pkg'))
  })

  it('--all shows packages with no constraint', () => {
    const allPkgs: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'lodash', version: '4.17.21' },
      { name: 'typescript', version: '5.0.4' }
    ]
    const output = renderOutput(targets, 247, allPkgs, 'package-lock.json', 'npm', true, false)
    assert.ok(output.includes('lodash'), 'lodash appears in --all output')
  })

  it('shows no-constraint message (not conflict) when ranges is empty', () => {
    const noConstraints: AnalysisTarget[] = [
      {
        name: 'node',
        source: 'engines',
        ranges: [],
        intersection: null,
        conflicts: [],
        latestRanges: [],
        latestIntersection: null,
        latestConflicts: [],
        invalidRanges: [],
        latestInvalidRanges: []
      }
    ]
    const output = renderOutput(noConstraints, 0, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.includes('no constraints found'), 'shows no-constraint message')
    assert.ok(!output.includes('conflict'), 'does not show conflict warning')
  })

  it('renders target with no current ranges', () => {
    const latestOnly: AnalysisTarget[] = [
      {
        name: 'node',
        source: 'engines',
        ranges: [],
        intersection: null,
        conflicts: [],
        latestRanges: [{ package: 'express', version: '5.0.0', range: '>=18.0.0' }],
        latestIntersection: '>=18.0.0',
        latestConflicts: [],
        invalidRanges: [],
        latestInvalidRanges: []
      }
    ]
    const output = renderOutput(latestOnly, 1, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.includes('node'))
  })

  it('showAll shows no extra section when all packages are constrained', () => {
    const constrained: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'typescript', version: '5.0.4' }
    ]
    const output = renderOutput(targets, 2, constrained, 'package-lock.json', 'npm', true, false)
    assert.ok(!output.includes('All packages (no constraint declared)'))
  })

  it('shows installed version in latestConflicts when package is in current ranges', () => {
    const withMatchingConflict: AnalysisTarget[] = [
      {
        ...targets[0],
        latestIntersection: null,
        latestConflicts: [{ package: 'express', version: '5.0.0', range: '>=20.0.0' }],
        invalidRanges: [],
        latestInvalidRanges: []
      }
    ]
    const output = renderOutput(
      withMatchingConflict,
      2,
      [],
      'package-lock.json',
      'npm',
      false,
      false
    )
    assert.ok(output.includes('express'))
  })
})

describe('renderOutput unparseable ranges', () => {
  /**
   * Builds a target whose ranges failed semver parsing.
   * @returns {AnalysisTarget} A target with only invalid ranges.
   */
  function invalidTarget(): AnalysisTarget {
    return {
      name: 'node',
      source: 'engines',
      ranges: [{ package: 'weird-pkg', version: '1.0.0', range: 'current' }],
      intersection: null,
      conflicts: [],
      invalidRanges: [{ package: 'weird-pkg', version: '1.0.0', range: 'current' }],
      latestRanges: [],
      latestIntersection: null,
      latestConflicts: [],
      latestInvalidRanges: []
    }
  }

  // Regression: an unparseable range produced "conflict — no safe range" with an
  // empty conflict list, sending the user after a nonexistent problem.
  it('does not report unparseable ranges as a conflict', () => {
    const output = renderOutput([invalidTarget()], 1, [], 'package-lock.json', 'npm', false, false)
    assert.ok(!output.includes('conflict — no safe range'))
    assert.ok(output.includes('no parseable constraints'))
  })

  it('lists the packages whose ranges could not be parsed', () => {
    const output = renderOutput([invalidTarget()], 1, [], 'package-lock.json', 'npm', false, false)
    assert.ok(output.includes('Unparseable ranges'))
    assert.ok(output.includes('weird-pkg'))
  })
})
