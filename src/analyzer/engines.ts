import type { Package, AnalysisTarget, RangeEntry, ManagerType } from '../types.js'
import { computeIntersection } from './intersect.js'

/**
 * Collects engine range entries for a given key from installed package versions.
 * @param {Package[]} packages List of packages to inspect.
 * @param {string} key The engine key (e.g. "node").
 * @returns {RangeEntry[]} Array of range entries for the key.
 */
function collectRanges(packages: Package[], key: string): RangeEntry[] {
  const ranges: RangeEntry[] = []
  for (const pkg of packages) {
    const range = pkg.engines?.[key]
    if (typeof range !== 'undefined' && range !== '*') {
      ranges.push({ package: pkg.name, version: pkg.version, range })
    }
  }
  return ranges
}

/**
 * Collects engine range entries for a given key from latest package versions.
 * @param {Package[]} packages List of packages to inspect.
 * @param {string} key The engine key (e.g. "node").
 * @returns {RangeEntry[]} Array of range entries from latest versions.
 */
function collectLatestRanges(packages: Package[], key: string): RangeEntry[] {
  const ranges: RangeEntry[] = []
  for (const pkg of packages) {
    const range = pkg.latestEngines?.[key]
    if (typeof range !== 'undefined' && range !== '*') {
      ranges.push({ package: pkg.name, version: pkg.latestVersion ?? pkg.version, range })
    }
  }
  return ranges
}

/**
 * Analyzes engine constraints across all packages for node and the active manager.
 * @param {Package[]} packages The full list of resolved packages.
 * @param {ManagerType} manager The active package manager type.
 * @returns {AnalysisTarget[]} Array of analysis targets with intersection results.
 */
export function analyzeEngines(packages: Package[], manager: ManagerType): AnalysisTarget[] {
  const targets: AnalysisTarget[] = []
  const keys = ['node', manager]

  for (const key of keys) {
    const ranges = collectRanges(packages, key)
    const latestRanges = collectLatestRanges(packages, key)

    if (ranges.length === 0 && latestRanges.length === 0) continue

    const { intersection, conflicts } = computeIntersection(ranges)
    const { intersection: latestIntersection, conflicts: latestConflicts } =
      computeIntersection(latestRanges)

    targets.push({
      name: key,
      source: 'engines',
      ranges,
      intersection,
      conflicts,
      latestRanges,
      latestIntersection,
      latestConflicts
    })
  }

  return targets
}
