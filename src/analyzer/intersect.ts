import semver from 'semver'
import type { RangeEntry } from '../types.js'

export interface IntersectionResult {
  intersection: string | null
  conflicts: RangeEntry[]
  /** Entries whose range string is not valid semver and could not be intersected */
  invalid: RangeEntry[]
}

/**
 * Simplifies one AND-group by deduplicating comparators.
 * For >= comparators, keeps only the highest. For < comparators, keeps only the lowest.
 * @param {readonly semver.Comparator[]} comparators The comparators of a single AND-group.
 * @returns {string} Simplified group string, or "*" when the group is unbounded.
 */
function simplifyGroup(comparators: readonly semver.Comparator[]): string {
  const gteVersions: semver.SemVer[] = []
  const ltVersions: semver.SemVer[] = []
  const others: string[] = []

  for (const comp of comparators) {
    if (comp.operator === '>=' && comp.semver.version !== '0.0.0') {
      gteVersions.push(comp.semver)
    } else if (comp.operator === '<') {
      ltVersions.push(comp.semver)
    } else if (comp.value !== '') {
      others.push(comp.value)
    }
  }

  const parts: string[] = []
  if (gteVersions.length > 0) {
    gteVersions.sort((a, b) => semver.compare(b, a))
    parts.push(`>=${gteVersions[0].version}`)
  }
  if (ltVersions.length > 0) {
    ltVersions.sort((a, b) => semver.compare(a, b))
    parts.push(`<${ltVersions[0].version}`)
  }
  parts.push(...new Set(others))
  return parts.length > 0 ? parts.join(' ') : '*'
}

/**
 * Simplifies a well-formed range by simplifying each OR-group and deduplicating groups.
 * @param {string} rangeStr Range string to simplify.
 * @returns {string} Simplified range string.
 */
function simplifyRange(rangeStr: string): string {
  try {
    const groups = new semver.Range(rangeStr).set.map(simplifyGroup)
    return [...new Set(groups)].join(' || ')
  } catch {
    /* c8 ignore next 2 */
    return rangeStr
  }
}

/**
 * Computes the logical AND of two semver ranges as a new range string.
 *
 * Range strings must never be intersected by concatenation: in semver grammar
 * `||` binds looser than the space (AND) operator, so `"A || B" + " " + "C"`
 * parses as `A || (B C)` rather than `(A || B) AND C`. Instead the AND is
 * distributed across both OR-sets and unsatisfiable groups are dropped.
 * @param {string} a Left-hand range.
 * @param {string} b Right-hand range.
 * @returns {string | null} Combined range, or null if the two ranges are disjoint.
 */
export function andRanges(a: string, b: string): string | null {
  const groups: string[] = []

  for (const groupA of new semver.Range(a).set) {
    for (const groupB of new semver.Range(b).set) {
      const comparators = [...groupA, ...groupB].map(c => c.value).filter(v => v !== '')
      const group = comparators.length > 0 ? comparators.join(' ') : '*'
      // minVersion is null exactly when the group is unsatisfiable (e.g. ">=18 <17")
      if (semver.minVersion(group) === null) continue
      groups.push(group)
    }
  }

  if (groups.length === 0) return null
  return groups.join(' || ')
}

/**
 * Computes the semver intersection of multiple range entries.
 * Returns null intersection with conflicts if ranges are disjoint, and reports
 * separately any entries whose range string is not valid semver.
 * @param {RangeEntry[]} ranges Array of range entries to intersect.
 * @returns {IntersectionResult} The intersection result with any conflicts.
 */
export function computeIntersection(ranges: RangeEntry[]): IntersectionResult {
  const valid: RangeEntry[] = []
  const invalid: RangeEntry[] = []
  for (const entry of ranges) {
    if (entry.range === '*') continue
    if (semver.validRange(entry.range) === null) {
      invalid.push(entry)
    } else {
      valid.push(entry)
    }
  }

  if (valid.length === 0) {
    return { intersection: null, conflicts: [], invalid }
  }

  // Sort by minimum version ascending for deterministic greedy pass
  const sorted = [...valid].sort((a, b) => {
    const minA = semver.minVersion(a.range)
    const minB = semver.minVersion(b.range)
    if (minA === null && minB === null) return 0
    if (minA === null) return 1
    if (minB === null) return -1
    return semver.compare(minA, minB)
  })

  const conflicts: RangeEntry[] = []
  let combined = semver.validRange(sorted[0].range) ?? sorted[0].range

  for (let i = 1; i < sorted.length; i++) {
    const entry = sorted[i]
    const next = andRanges(combined, entry.range)
    if (next === null) {
      conflicts.push(entry)
    } else {
      combined = next
    }
  }

  if (conflicts.length > 0) {
    return { intersection: null, conflicts, invalid }
  }

  return { intersection: simplifyRange(combined), conflicts: [], invalid }
}
