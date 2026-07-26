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

interface GreedyRun {
  combined: string
  accepted: RangeEntry[]
  conflicts: RangeEntry[]
}

/**
 * Greedily folds entries into one range, starting from a chosen seed.
 * @param {RangeEntry} seed The entry to start from; always accepted.
 * @param {RangeEntry[]} entries All entries, in a stable order.
 * @returns {GreedyRun} The combined range plus the accepted and rejected entries.
 */
function greedyFrom(seed: RangeEntry, entries: RangeEntry[]): GreedyRun {
  let combined = semver.validRange(seed.range) ?? seed.range
  const accepted: RangeEntry[] = [seed]
  const conflicts: RangeEntry[] = []

  for (const entry of entries) {
    if (entry === seed) continue
    const next = andRanges(combined, entry.range)
    if (next === null) {
      conflicts.push(entry)
    } else {
      combined = next
      accepted.push(entry)
    }
  }

  return { combined, accepted, conflicts }
}

/**
 * Picks one entry per distinct normalized range, preserving input order.
 *
 * Two packages declaring the same range are interchangeable as seeds, so only
 * distinct constraints need trying. That keeps the search proportional to the
 * number of distinct ranges — typically a handful even when hundreds of
 * packages declare them — rather than to the number of packages.
 * @param {RangeEntry[]} entries Entries in a stable order.
 * @returns {RangeEntry[]} One representative per distinct range.
 */
function distinctByRange(entries: RangeEntry[]): RangeEntry[] {
  const seen = new Set<string>()
  const representatives: RangeEntry[] = []
  for (const entry of entries) {
    const key = semver.validRange(entry.range) ?? entry.range
    if (seen.has(key)) continue
    seen.add(key)
    representatives.push(entry)
  }
  return representatives
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

  let best = greedyFrom(sorted[0], sorted)

  if (best.conflicts.length > 0) {
    // The first pass is seeded with the lowest minimum version, and a seed is
    // accepted by construction — so it can never be reported as a conflict.
    // That blames whichever entries disagree with the seed even when the seed
    // is the sole outlier.
    //
    // Every distinct range is tried as a seed and the largest agreeing set
    // wins. Seeding only from the conflicts of the first pass is not enough:
    // with one low outlier, eight mid entries and nine high ones, the first
    // pass conflicts are the mid and high groups, and stopping early at a
    // fixed number of candidates can miss the high group entirely and report
    // the nine agreeing entries as the conflict. Ties keep the earliest
    // candidate, so the result stays independent of input order.
    for (const seed of distinctByRange(sorted)) {
      if (seed === sorted[0]) continue
      const run = greedyFrom(seed, sorted)
      if (run.accepted.length > best.accepted.length) {
        best = run
      }
    }
  }

  if (best.conflicts.length > 0) {
    return { intersection: null, conflicts: best.conflicts, invalid }
  }

  return { intersection: simplifyRange(best.combined), conflicts: [], invalid }
}
