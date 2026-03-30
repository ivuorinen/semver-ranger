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
      latestConflicts: []
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
        latestConflicts: [{ package: 'old-pkg', version: '2.0.0', range: '<20.0.0' }]
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
        latestConflicts: []
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
        latestConflicts: [{ package: 'express', version: '5.0.0', range: '>=20.0.0' }]
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
