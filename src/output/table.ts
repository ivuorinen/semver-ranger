import type { AnalysisTarget, Package, RangeEntry } from '../types.ts'

// A pseudo-terminal allocated without a size reports 0 columns, not undefined.
const WIDTH = process.stdout.columns || 80
const SEP = '─'.repeat(WIDTH)

const COL_PKG = 28
const COL_VER = 12
const COL_LATEST = 12
const COL_RANGE = Math.max(WIDTH - COL_PKG - COL_VER - COL_LATEST - 6, 20)

interface Column {
  text: string
  width: number
}

/**
 * Word-wraps text, hard-breaking any word too long to fit a line of its own.
 * Measures with String.length: names, versions and ranges are ASCII, and the only
 * symbols this file adds (⚠ — ─) occupy one UTF-16 unit each.
 *
 * Control characters are removed first. This text comes from lockfiles and
 * registry manifests, and an escape sequence in a range could rewrite earlier
 * output, hiding a conflict, or drive the terminal.
 * @param {string} text The text to wrap; surrounding spaces add nothing to a line.
 * @param {number} width Maximum line length.
 * @returns {string[]} The wrapped lines; at least one.
 */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.replace(/\p{Cc}/gu, '').split(' ')) {
    if (line !== '') line += ' '
    if (word.length > width) {
      for (const char of word) {
        if (line.length >= width) {
          lines.push(line.trimEnd())
          line = ''
        }
        line += char
      }
    } else if (word !== '' && line.length + word.length > width) {
      lines.push(line.trimEnd())
      line = word
    } else {
      line += word
    }
  }
  lines.push(line.trimEnd())
  return lines
}

/**
 * Word-wraps text, repeating its leading spaces on every line.
 * @param {string} text The text to wrap.
 * @param {number} width Maximum line length, indent included.
 * @returns {string[]} The wrapped lines; at least one.
 */
function wrapIndented(text: string, width: number): string[] {
  const indent = text.length - text.trimStart().length
  return wrap(text, width - indent).map(line => ' '.repeat(indent) + line)
}

/**
 * Creates a line buffer that lays text out to the current terminal width.
 * @returns {{div: Function, toString: Function}} The buffer's writer and renderer.
 */
function makeUi(): {
  div: (...columns: [string] | Column[]) => void
  toString: () => string
} {
  const lines: string[] = []
  return {
    /**
     * Appends one row: either a single string, or columns that wrap independently
     * within their own widths.
     *
     * Every column but the last wraps one short of its width. Filled to the
     * edge, a long name ran straight into the version beside it and read as a
     * different name or version.
     * @param {[string] | Column[]} columns A single string, or the row's columns.
     * @returns {void}
     */
    div(...columns: [string] | Column[]): void {
      const [first] = columns
      if (typeof first === 'string') {
        lines.push(...wrapIndented(first, WIDTH))
        return
      }
      const row = columns as Column[]
      const cells = row.map((column, position) =>
        wrapIndented(column.text, position < row.length - 1 ? column.width - 1 : column.width)
      )
      const height = Math.max(...cells.map(cell => cell.length))
      for (let index = 0; index < height; index += 1) {
        const parts = row.map((column, position) =>
          (cells[position]?.[index] ?? '').padEnd(column.width)
        )
        lines.push(parts.join('').trimEnd())
      }
    },
    toString: () => lines.join('\n')
  }
}

/**
 * Renders a single package row into a layout.
 * @param {ReturnType<typeof makeUi>} ui The layout to write into.
 * @param {RangeEntry} entry The range entry to render.
 * @param {string} latestVersion Latest known version string for the package.
 * @param {string} prefix Optional prefix prepended to the package name column.
 * @returns {void}
 */
function renderPackageRow(
  ui: ReturnType<typeof makeUi>,
  entry: RangeEntry,
  latestVersion: string,
  prefix = '  '
): void {
  ui.div(
    { text: prefix + entry.package, width: COL_PKG },
    { text: entry.version, width: COL_VER },
    { text: latestVersion, width: COL_LATEST },
    { text: entry.range, width: COL_RANGE }
  )
}

/**
 * Resolves the display text for a safe-range cell.
 * @param {string | null} intersection Computed intersection or null.
 * @param {number} conflictCount Number of entries that break the intersection.
 * @param {number} invalidCount Number of entries whose range is not valid semver.
 * @returns {string} Display string for the safe-range cell.
 */
function safeRangeText(
  intersection: string | null,
  conflictCount: number,
  invalidCount: number
): string {
  if (intersection !== null) {
    return intersection
  }
  if (conflictCount > 0) {
    return '⚠  conflict — no safe range'
  }
  if (invalidCount > 0) {
    return '— (no parseable constraints)'
  }
  return '— (no constraints found)'
}

/**
 * Renders a single analysis target section as a formatted string.
 *
 * A row's Latest column falls back to the package's own latest version: the
 * latest ranges hold only releases that still declare the constraint, so the
 * upgrade that drops it showed as unknown. --all matches by name and version,
 * since matching by name hid an unconstrained copy of a constrained package.
 * Packages are looked up through one map: a scan of the whole list per row made
 * rendering quadratic, nearly a second per target at 20,000 packages.
 * @param {AnalysisTarget} target The analysis target to render.
 * @param {Package[]} allPackages All packages in the lockfile.
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @returns {string} Formatted multi-line string for the target section.
 */
function renderTarget(target: AnalysisTarget, allPackages: Package[], showAll: boolean): string {
  const ui = makeUi()
  const totalDeclaring = target.ranges.length

  ui.div(`  ${target.name} (${target.source})   ${totalDeclaring} package(s) declare a constraint`)
  ui.div(`  ${'─'.repeat(Math.max(WIDTH - 4, 0))}`)

  const labelInstalled = `  Safe ${target.name} range (installed):`
  const labelLatest = `  Safe ${target.name} range (latest):`
  const labelWidth = Math.max(labelInstalled.length, labelLatest.length) + 2
  const valueWidth = Math.max(WIDTH - labelWidth, 30)

  ui.div(
    { text: labelInstalled, width: labelWidth },
    {
      text: safeRangeText(
        target.intersection,
        target.conflicts.length,
        target.invalidRanges.length
      ),
      width: valueWidth
    }
  )
  ui.div(
    { text: labelLatest, width: labelWidth },
    {
      text: safeRangeText(
        target.latestIntersection,
        target.latestConflicts.length,
        target.latestInvalidRanges.length
      ),
      width: valueWidth
    }
  )

  if (target.ranges.length > 0) {
    ui.div('')
    ui.div('  Declared constraints (installed):')
    ui.div(
      { text: '  Package', width: COL_PKG },
      { text: 'Installed', width: COL_VER },
      { text: 'Latest', width: COL_LATEST },
      { text: 'Range', width: COL_RANGE }
    )
    const latestByPkg = new Map(target.latestRanges.map(r => [r.package, r]))
    const byId = new Map(allPackages.map(p => [`${p.name}@${p.version}`, p]))
    for (const entry of target.ranges) {
      const own = byId.get(`${entry.package}@${entry.version}`)
      const latest = latestByPkg.get(entry.package)?.version ?? own?.latest?.version
      renderPackageRow(ui, entry, latest ?? '—')
    }
  }

  if (target.conflicts.length > 0) {
    ui.div('')
    ui.div(`  ⚠  Conflicts at installed (${target.conflicts.length} package(s) cause conflict):`)
    for (const entry of target.conflicts) {
      renderPackageRow(ui, entry, '—', '  ⚠  ')
    }
  }

  if (target.latestConflicts.length > 0) {
    ui.div('')
    ui.div(`  ⚠  Conflicts at latest (${target.latestConflicts.length} package(s) block upgrade):`)
    const rangesByPkg = new Map(target.ranges.map(r => [r.package, r]))
    for (const entry of target.latestConflicts) {
      const installed = rangesByPkg.get(entry.package)
      // columns intentionally inverted: installed in COL_VER, latest in COL_LATEST
      // to show which latest version is blocked by the installed range
      ui.div(
        { text: `  ⚠  ${entry.package}`, width: COL_PKG },
        { text: installed?.version ?? '—', width: COL_VER },
        { text: entry.version, width: COL_LATEST },
        { text: entry.range, width: COL_RANGE }
      )
    }
  }

  const invalid = [...target.invalidRanges, ...target.latestInvalidRanges]
  if (invalid.length > 0) {
    ui.div('')
    ui.div(`  ⚠  Unparseable ranges (${invalid.length} package(s), excluded from analysis):`)
    for (const entry of invalid) {
      renderPackageRow(ui, entry, '—', '  ⚠  ')
    }
  }

  if (showAll) {
    const constrained = new Set(target.ranges.map(r => `${r.package}@${r.version}`))
    const unconstrained = allPackages.filter(p => !constrained.has(`${p.name}@${p.version}`))
    if (unconstrained.length > 0) {
      ui.div('')
      ui.div('  All packages (no constraint declared):')
      ui.div(
        { text: '  Package', width: COL_PKG },
        { text: 'Installed', width: COL_VER },
        { text: 'Latest', width: COL_LATEST },
        { text: 'Range', width: COL_RANGE }
      )
      for (const pkg of unconstrained) {
        ui.div(
          { text: `  ${pkg.name}`, width: COL_PKG },
          { text: pkg.version, width: COL_VER },
          { text: pkg.latest?.version ?? '—', width: COL_LATEST },
          { text: '—', width: COL_RANGE }
        )
      }
    }
  }

  return ui.toString()
}

/**
 * Renders the full analysis output as formatted tables.
 * JSON is built by the CLI, which holds the unresolved lookups it must carry.
 * @param {AnalysisTarget[]} targets Analysis targets to include in the output.
 * @param {Package[]} packages Full package list for the count and --all rendering.
 * @param {string} lockfileName Filename of the detected lockfile.
 * @param {string} manager Package manager name (npm, yarn, pnpm).
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @returns {string} The formatted output string.
 */
export function renderOutput(
  targets: AnalysisTarget[],
  packages: Package[],
  lockfileName: string,
  manager: string,
  showAll: boolean
): string {
  const ui = makeUi()

  ui.div(`semver-ranger — analyzing ${packages.length} packages`)
  ui.div('')
  ui.div({ text: '  Lockfile:', width: 14 }, { text: `${lockfileName} (${manager})`, width: 60 })
  ui.div(
    { text: '  Targets:', width: 14 },
    {
      text:
        targets.map(t => t.name).join(', ') !== '' ? targets.map(t => t.name).join(', ') : 'none',
      width: 60
    }
  )
  ui.div('')
  ui.div(SEP)

  const parts = [ui.toString()]

  for (const target of targets) {
    parts.push('')
    parts.push(renderTarget(target, packages, showAll))
    parts.push(SEP)
  }

  return parts.join('\n')
}
