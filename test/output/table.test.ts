import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnalysisTarget, Package } from '../../src/types.ts'

// The layout width is read when the module loads, and wrapping depends on it.
// 0, as from a pseudo-terminal without a size, takes the 80-column fallback here
// too: run only by CLI children, its branch is dropped by Node's coverage merge,
// which .github/scripts/coverage-merge-guard.mjs then reports.
process.stdout.columns = 0
const { renderOutput } = await import('../../src/output/table.ts')

describe('renderOutput cost', () => {
  // Regression: each declaring row scanned the whole package list for its own
  // latest version, so rendering was quadratic in lockfile size.
  it('reads the package list a bounded number of times, not once per row', () => {
    const count = 1_000
    const packages: Package[] = Array.from({ length: count }, (_, i) => ({
      name: `p${i}`,
      version: '1.0.0',
      latest: { version: '2.0.0' }
    }))
    let reads = 0
    const counted = new Proxy(packages, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1
        return Reflect.get(target, key, receiver) as unknown
      }
    })
    const target: AnalysisTarget = {
      name: 'node',
      source: 'engines',
      ranges: packages.map(({ name, version }) => ({ package: name, version, range: '>=18' })),
      intersection: '>=18.0.0',
      conflicts: [],
      latestRanges: [],
      latestIntersection: null,
      latestConflicts: [],
      invalidRanges: [],
      latestInvalidRanges: []
    }
    const lines = renderOutput([target], counted, 'package-lock.json', 'npm', false).split('\n')
    // The last package is still found, and a per-row scan would read ~count²/2 times.
    assert.ok(
      lines.some(line => line.startsWith(`${'  p999'.padEnd(28)}${'1.0.0'.padEnd(12)}2.0.0`))
    )
    assert.ok(reads <= 2 * count, `read the package list ${reads} times`)
  })
})

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

  it('renders the lockfile, both safe ranges and the declaring packages', () => {
    const packages = [{ name: 'a', version: '1.0.0' }]
    const lines = renderOutput(targets, packages, 'package-lock.json', 'npm', false).split('\n')
    for (const expected of [
      'semver-ranger — analyzing 1 packages',
      `${'  Lockfile:'.padEnd(14)}package-lock.json (npm)`,
      `${'  Targets:'.padEnd(14)}node`,
      '  node (engines)   2 package(s) declare a constraint',
      `${'  Safe node range (installed):'.padEnd(32)}>=14.0.0`,
      `${'  Safe node range (latest):'.padEnd(32)}>=18.0.0`,
      `${'  express'.padEnd(28)}${'4.18.2'.padEnd(12)}${'5.0.0'.padEnd(12)}>=14.0.0`,
      `${'  typescript'.padEnd(28)}${'5.0.4'.padEnd(12)}${'—'.padEnd(12)}>=12.20`
    ]) {
      assert.ok(lines.includes(expected), `missing "${expected}" in:\n${lines.join('\n')}`)
    }
  })

  it('shows conflict warning when conflicts exist', () => {
    const conflicting: AnalysisTarget[] = [
      {
        ...targets[0],
        intersection: null,
        conflicts: [{ package: 'legacy-pkg', version: '1.0.0', range: '<18.0.0' }]
      }
    ]
    const output = renderOutput(conflicting, [], 'package-lock.json', 'npm', false)
    const lines = output.split('\n')
    assert.ok(
      lines.includes(`${'  Safe node range (installed):'.padEnd(32)}⚠  conflict — no safe range`)
    )
    assert.ok(lines.includes('  ⚠  Conflicts at installed (1 package(s) cause conflict):'))
    assert.ok(
      lines.includes(`${'  ⚠  legacy-pkg'.padEnd(28)}${'1.0.0'.padEnd(12)}${'—'.padEnd(12)}<18.0.0`)
    )
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
    const output = renderOutput(conflictingLatest, [], 'package-lock.json', 'npm', false)
    const lines = output.split('\n')
    assert.ok(lines.includes('  ⚠  Conflicts at latest (1 package(s) block upgrade):'))
    assert.ok(
      lines.includes(`${'  ⚠  old-pkg'.padEnd(28)}${'—'.padEnd(12)}${'2.0.0'.padEnd(12)}<20.0.0`)
    )
  })

  it('--all lists only the packages with no constraint', () => {
    const allPkgs: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'lodash', version: '4.17.21' },
      { name: 'ms', version: '2.0.0', latest: { version: '2.1.3' } },
      { name: 'typescript', version: '5.0.4' }
    ]
    const lines = renderOutput(targets, allPkgs, 'package-lock.json', 'npm', true).split('\n')
    const heading = lines.indexOf('  All packages (no constraint declared):')
    assert.notStrictEqual(heading, -1, 'the section is missing')
    const section = lines.slice(heading)
    assert.ok(section.includes(`${'  lodash'.padEnd(28)}${'4.17.21'.padEnd(12)}${'—'.padEnd(12)}—`))
    assert.ok(section.includes(`${'  ms'.padEnd(28)}${'2.0.0'.padEnd(12)}${'2.1.3'.padEnd(12)}—`))
    assert.ok(
      !section.some(line => line.startsWith('  express')),
      'a constrained package leaked in'
    )
  })

  // Regression: --all excluded by name, so this unconstrained copy was never listed.
  it('--all lists an unconstrained version of a package that has a constrained one', () => {
    const target: AnalysisTarget = {
      ...targets[0],
      ranges: [{ package: 'debug', version: '4.3.4', range: '>=6.0' }],
      latestRanges: []
    }
    const allPkgs: Package[] = [
      { name: 'debug', version: '4.3.4' },
      { name: 'debug', version: '2.6.9' }
    ]
    const lines = renderOutput([target], allPkgs, 'package-lock.json', 'npm', true).split('\n')
    const section = lines.slice(lines.indexOf('  All packages (no constraint declared):'))
    assert.ok(section.includes(`${'  debug'.padEnd(28)}${'2.6.9'.padEnd(12)}${'—'.padEnd(12)}—`))
    assert.ok(!section.some(line => line.includes('4.3.4')), 'the constrained copy leaked in')
  })

  // Regression: the latest ranges hold only releases that still declare the
  // constraint, so the release that dropped it showed as unknown.
  it('shows the latest version when that release declares no constraint', () => {
    const target: AnalysisTarget = {
      ...targets[0],
      ranges: [{ package: 'foo', version: '1.0.0', range: '>=12' }],
      latestRanges: []
    }
    const packages: Package[] = [{ name: 'foo', version: '1.0.0', latest: { version: '3.0.0' } }]
    const lines = renderOutput([target], packages, 'package-lock.json', 'npm', false).split('\n')
    assert.ok(lines.includes(`${'  foo'.padEnd(28)}${'1.0.0'.padEnd(12)}${'3.0.0'.padEnd(12)}>=12`))
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
    const output = renderOutput(noConstraints, [], 'package-lock.json', 'npm', false)
    assert.ok(output.includes('no constraints found'), 'shows no-constraint message')
    assert.ok(!output.includes('conflict'), 'does not show conflict warning')
  })

  it('omits the declared table when only the latest versions have constraints', () => {
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
    const output = renderOutput(latestOnly, [], 'package-lock.json', 'npm', false)
    const lines = output.split('\n')
    assert.ok(
      lines.includes(`${'  Safe node range (installed):'.padEnd(32)}— (no constraints found)`)
    )
    assert.ok(lines.includes(`${'  Safe node range (latest):'.padEnd(32)}>=18.0.0`))
    assert.ok(!output.includes('Declared constraints'))
  })

  it('showAll shows no extra section when all packages are constrained', () => {
    const constrained: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'typescript', version: '5.0.4' }
    ]
    const output = renderOutput(targets, constrained, 'package-lock.json', 'npm', true)
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
    const output = renderOutput(withMatchingConflict, [], 'package-lock.json', 'npm', false)
    assert.ok(
      output
        .split('\n')
        .includes(`${'  ⚠  express'.padEnd(28)}${'4.18.2'.padEnd(12)}${'5.0.0'.padEnd(12)}>=20.0.0`)
    )
  })
})

describe('renderOutput complete report', () => {
  const SEP = '─'.repeat(80)
  const RULE = `  ${'─'.repeat(76)}`
  const row = (name: string, installed: string, latest: string, range: string) =>
    `${`  ${name}`.padEnd(28)}${installed.padEnd(12)}${latest.padEnd(12)}${range}`
  const HEADINGS = row('Package', 'Installed', 'Latest', 'Range')
  const CONFLICT = '⚠  conflict — no safe range'

  const legacy = { package: 'legacy', version: '1.0.0', range: '<1.0.0' }
  // 22 characters is exactly the range column at 80 columns.
  const fullWidth = { package: 'express', version: '4.18.2', range: '>=1.0.0 <2.0.0 || >=30' }
  const free = { package: 'free', version: '1.0.0', range: '^18' }
  const failing: AnalysisTarget = {
    name: 'node',
    source: 'engines',
    ranges: [fullWidth, legacy],
    intersection: null,
    conflicts: [legacy],
    latestRanges: [{ package: 'express', version: '5.0.0', range: '>=18' }],
    latestIntersection: null,
    latestConflicts: [{ package: 'express', version: '5.0.0', range: '<1' }],
    // A word as wide as the column moves to its own line instead of being cut.
    invalidRanges: [{ package: 'weird', version: '1.0.0', range: `>=1 ${'x'.repeat(22)}` }],
    latestInvalidRanges: []
  }
  // Fills the 47-column value exactly, so the next word has to wrap.
  const FULL_VALUE = '>=18.0.0 <19.0.0 || >=20.0.0 <21.0.0 || >=22.10'
  const passing: AnalysisTarget = {
    name: 'react',
    source: 'peerDependencies',
    ranges: [free],
    intersection: `${FULL_VALUE} <23`,
    conflicts: [],
    latestRanges: [{ ...free, version: '2.1.0' }],
    latestIntersection: '^18',
    latestConflicts: [],
    invalidRanges: [],
    latestInvalidRanges: []
  }
  const packages: Package[] = [
    { name: 'express', version: '4.18.2' },
    { name: 'legacy', version: '1.0.0' },
    { name: 'free', version: '1.0.0', latest: { version: '2.1.0' } }
  ]

  it('prints every section in order, and only the sections that apply', () => {
    const output = renderOutput([failing, passing], packages, 'lock.json', 'npm', true)
    assert.deepStrictEqual(output.split('\n'), [
      'semver-ranger — analyzing 3 packages',
      '',
      `${'  Lockfile:'.padEnd(14)}lock.json (npm)`,
      `${'  Targets:'.padEnd(14)}node, react`,
      '',
      SEP,
      '',
      '  node (engines)   2 package(s) declare a constraint',
      RULE,
      `${'  Safe node range (installed):'.padEnd(32)}${CONFLICT}`,
      `${'  Safe node range (latest):'.padEnd(32)}${CONFLICT}`,
      '',
      '  Declared constraints (installed):',
      HEADINGS,
      row('express', '4.18.2', '5.0.0', '>=1.0.0 <2.0.0 || >=30'),
      row('legacy', '1.0.0', '—', '<1.0.0'),
      '',
      '  ⚠  Conflicts at installed (1 package(s) cause conflict):',
      row('⚠  legacy', '1.0.0', '—', '<1.0.0'),
      '',
      '  ⚠  Conflicts at latest (1 package(s) block upgrade):',
      row('⚠  express', '4.18.2', '5.0.0', '<1'),
      '',
      '  ⚠  Unparseable ranges (1 package(s), excluded from analysis):',
      row('⚠  weird', '1.0.0', '—', '>=1'),
      `${' '.repeat(52)}${'x'.repeat(22)}`,
      '',
      '  All packages (no constraint declared):',
      HEADINGS,
      row('free', '1.0.0', '2.1.0', '—'),
      SEP,
      '',
      '  react (peerDependencies)   1 package(s) declare a constraint',
      RULE,
      `${'  Safe react range (installed):'.padEnd(33)}${FULL_VALUE}`,
      `${' '.repeat(33)}<23`,
      `${'  Safe react range (latest):'.padEnd(33)}^18`,
      '',
      '  Declared constraints (installed):',
      HEADINGS,
      row('free', '1.0.0', '2.1.0', '^18'),
      '',
      '  All packages (no constraint declared):',
      HEADINGS,
      row('express', '4.18.2', '—', '—'),
      row('legacy', '1.0.0', '—', '—'),
      SEP
    ])
  })

  /**
   * Renders the target's heading under a given name.
   * @param {string} name The target name, which starts the wrapped heading.
   * @returns {string[]} The rendered lines from the heading onwards.
   */
  function heading(name: string): string[] {
    const lines = renderOutput([{ ...passing, name }], [], 'x', 'npm', false).split('\n')
    return lines.slice(lines.findIndex(line => line.startsWith('  n')))
  }

  it('wraps an indented heading to the terminal width with no trailing space', () => {
    // With " (peerDependencies)" this is 81 columns: too wide once the indent is counted.
    const name = 'n'.repeat(62)
    assert.deepStrictEqual(heading(name).slice(0, 2), [
      `  ${name}`,
      '  (peerDependencies)   1 package(s) declare a constraint'
    ])
  })

  it('leaves no trailing space before a word that is hard-broken', () => {
    const [first] = heading(`${'n'.repeat(77)} ${'m'.repeat(80)}`)
    assert.strictEqual(first, `  ${'n'.repeat(77)}`)
  })
})

describe('renderOutput layout', () => {
  /**
   * Renders one package row and returns the output as lines.
   * @param {string} name Package name.
   * @param {string} range Declared range.
   * @param {string} version Installed version, which is also the latest.
   * @returns {string[]} The rendered lines.
   */
  function renderRow(name: string, range: string, version = '9.4.1'): string[] {
    const entry = { package: name, version, range }
    const target: AnalysisTarget = {
      name: 'node',
      source: 'engines',
      ranges: [entry],
      intersection: range,
      conflicts: [],
      latestRanges: [entry],
      latestIntersection: range,
      latestConflicts: [],
      invalidRanges: [],
      latestInvalidRanges: []
    }
    return renderOutput([target], [], 'package-lock.json', 'npm', false).split('\n')
  }

  it('aligns columns and wraps a long range inside its own column', () => {
    const lines = renderRow('ora', '^20.19.0 || ^22.13.0 || >=24')
    const row = lines.findIndex(line => line.startsWith('  ora'))
    const columns = `${'  ora'.padEnd(28)}${'9.4.1'.padEnd(12)}${'9.4.1'.padEnd(12)}`
    assert.strictEqual(lines[row], `${columns}^20.19.0 || ^22.13.0`)
    assert.strictEqual(lines[row + 1], `${' '.repeat(columns.length)}|| >=24`)
  })

  it('hard-breaks a name wider than its column without losing characters', () => {
    const lines = renderRow('@typescript-eslint/eslint-plugin', '>=18')
    const row = lines.findIndex(line => line.startsWith('  @typescript-eslint/eslint '))
    assert.ok(lines[row].endsWith('>=18'))
    assert.strictEqual(lines[row + 1], '  -plugin')
  })

  // Regression: cells were wrapped to their full width and joined with nothing,
  // so a 26-character name ran into the version and read as another name.
  it('keeps a space between columns when a cell fills its width', () => {
    const lines = renderRow('@babel/helper-plugin-utils', '>=6', '1.0.0-beta.1')
    const row = lines.findIndex(line => line.startsWith('  @babel/'))
    const version = '1.0.0-beta.'.padEnd(12)
    assert.strictEqual(
      lines[row],
      `${'  @babel/helper-plugin-util'.padEnd(28)}${version}${version}>=6`
    )
    assert.strictEqual(lines[row + 1], `${'  s'.padEnd(28)}${'1'.padEnd(12)}1`)
  })

  it('keeps the indent of plain text lines', () => {
    const lines = renderRow('ora', '>=18')
    assert.ok(lines.includes('  node (engines)   1 package(s) declare a constraint'))
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
    const output = renderOutput([invalidTarget()], [], 'package-lock.json', 'npm', false)
    assert.ok(!output.includes('conflict — no safe range'))
    assert.ok(output.includes('no parseable constraints'))
  })

  it('lists the packages whose ranges could not be parsed', () => {
    const output = renderOutput([invalidTarget()], [], 'package-lock.json', 'npm', false)
    const lines = output.split('\n')
    assert.ok(lines.includes('  ⚠  Unparseable ranges (1 package(s), excluded from analysis):'))
    assert.ok(
      lines.includes(`${'  ⚠  weird-pkg'.padEnd(28)}${'1.0.0'.padEnd(12)}${'—'.padEnd(12)}current`)
    )
  })

  it('counts unparseable ranges at the installed and latest versions together', () => {
    const entry = { package: 'old', version: '2.0.0', range: 'latest' }
    const target = { ...invalidTarget(), latestInvalidRanges: [entry] }
    const output = renderOutput([target], [], 'package-lock.json', 'npm', false)
    assert.ok(output.includes('Unparseable ranges (2 package(s), excluded from analysis):'))
    assert.ok(output.includes('⚠  old'))
  })
})

describe('renderOutput with hostile or degenerate input', () => {
  const target = (range: string) => ({
    name: 'node',
    source: 'engines' as const,
    ranges: [{ package: 'a', version: '1.0.0', range }],
    intersection: null,
    conflicts: [],
    invalidRanges: [{ package: 'a', version: '1.0.0', range }],
    latestRanges: [],
    latestIntersection: null,
    latestConflicts: [],
    latestInvalidRanges: []
  })

  it('removes control characters from third-party text', () => {
    const escape = String.fromCharCode(27)
    const output = renderOutput([target(`${escape}]0;pwned`)], [], 'x', 'npm', false)
    assert.ok(!output.includes(escape))
    assert.ok(
      output
        .split('\n')
        .includes(`${'  ⚠  a'.padEnd(28)}${'1.0.0'.padEnd(12)}${'—'.padEnd(12)}]0;pwned`)
    )
  })

  it('counts the packages it was given', () => {
    const packages = [
      { name: 'a', version: '1.0.0' },
      { name: 'b', version: '1.0.0' }
    ]
    const output = renderOutput([], packages, 'x', 'npm', false)
    assert.ok(output.includes('analyzing 2 packages'))
    assert.ok(output.split('\n').includes(`${'  Targets:'.padEnd(14)}none`))
  })
})
