import cliui from 'cliui'
import type { AnalysisTarget, Package, RangeEntry } from '../types.js'

const WIDTH = process.stdout.columns || 80
const SEP = '─'.repeat(WIDTH)

const COL_PKG = 28
const COL_VER = 12
const COL_LATEST = 12
const COL_RANGE = Math.max(WIDTH - COL_PKG - COL_VER - COL_LATEST - 6, 20)

/**
 * Creates a new cliui instance sized to the current terminal width.
 */
function makeUi(): ReturnType<typeof cliui> {
  return cliui({ width: WIDTH })
}

/**
 * Renders a single package row into a cliui layout.
 * @param ui The cliui instance to write into.
 * @param entry The range entry to render.
 * @param latestVersion Latest known version string for the package.
 * @param prefix Optional prefix prepended to the package name column.
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
    { text: latestVersion || '—', width: COL_LATEST },
    { text: entry.range, width: COL_RANGE }
  )
}

/**
 * Resolves the display text for a safe-range cell.
 * @param {string | null} intersection Computed intersection or null.
 * @param {number} rangeCount Number of contributing ranges.
 * @returns {string} Display string for the safe-range cell.
 */
function safeRangeText(intersection: string | null, rangeCount: number): string {
  if (intersection !== null) {
    return intersection
  }
  if (rangeCount === 0) {
    return '— (no constraints found)'
  }
  return '⚠  conflict — no safe range'
}

/**
 * Renders a single analysis target section as a formatted string.
 * @param {AnalysisTarget} target The analysis target to render.
 * @param {Package[]} allPackages All packages in the lockfile.
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @returns {string} Formatted multi-line string for the target section.
 */
function renderTarget(target: AnalysisTarget, allPackages: Package[], showAll: boolean): string {
  const ui = makeUi()
  const totalDeclaring = target.ranges.length

  ui.div(`  ${target.name} (${target.source})   ${totalDeclaring} package(s) declare a constraint`)
  ui.div(`  ${'─'.repeat(WIDTH - 4)}`)

  ui.div(
    { text: '  Safe range (installed):', width: 30 },
    { text: safeRangeText(target.intersection, target.ranges.length), width: 50 }
  )
  ui.div(
    { text: '  Safe range (latest):', width: 30 },
    { text: safeRangeText(target.latestIntersection, target.latestRanges.length), width: 50 }
  )

  if (target.ranges.length > 0) {
    ui.div('')
    ui.div('  Most restrictive (installed):')
    ui.div(
      { text: '  Package', width: COL_PKG },
      { text: 'Installed', width: COL_VER },
      { text: 'Latest', width: COL_LATEST },
      { text: 'Range', width: COL_RANGE }
    )
    const latestByPkg = new Map(target.latestRanges.map(r => [r.package, r]))
    for (const entry of target.ranges) {
      const latest = latestByPkg.get(entry.package)
      renderPackageRow(ui, entry, latest?.version ?? '—')
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
      ui.div(
        { text: `  ⚠  ${entry.package}`, width: COL_PKG },
        { text: installed?.version ?? '—', width: COL_VER },
        { text: entry.version, width: COL_LATEST },
        { text: entry.range, width: COL_RANGE }
      )
    }
  }

  if (showAll) {
    const constrainedNames = new Set(target.ranges.map(r => r.package))
    const unconstrained = allPackages.filter(p => !constrainedNames.has(p.name))
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
          { text: pkg.latestVersion ?? '—', width: COL_LATEST },
          { text: '—', width: COL_RANGE }
        )
      }
    }
  }

  return ui.toString()
}

/**
 * Renders the full analysis output as a formatted cliui table or JSON string.
 * @param {AnalysisTarget[]} targets Analysis targets to include in the output.
 * @param {number} totalPackages Total number of packages analyzed.
 * @param {Package[]} packages Full package list for --all rendering.
 * @param {string} lockfileName Filename of the detected lockfile.
 * @param {string} manager Package manager name (npm, yarn, pnpm).
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @param {boolean} json When true, returns a raw JSON string instead of a table.
 * @returns {string} The formatted output string.
 */
export function renderOutput(
  targets: AnalysisTarget[],
  totalPackages: number,
  packages: Package[],
  lockfileName: string,
  manager: string,
  showAll: boolean,
  json: boolean
): string {
  if (json) {
    return JSON.stringify(targets, null, 2)
  }

  const ui = makeUi()

  ui.div(`semver-ranger — analyzing ${totalPackages} packages`)
  ui.div('')
  ui.div({ text: '  Lockfile:', width: 14 }, { text: `${lockfileName} (${manager})`, width: 60 })
  ui.div(
    { text: '  Targets:', width: 14 },
    { text: targets.map(t => t.name).join(', ') || 'none', width: 60 }
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
