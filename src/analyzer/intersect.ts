import semver from 'semver'
import type { RangeEntry } from '../types.js'

export interface IntersectionResult {
  intersection: string | null
  conflicts: RangeEntry[]
}

/**
 * Computes the semver intersection of multiple range entries.
 * Returns null intersection with conflicts if ranges are disjoint.
 * @param {RangeEntry[]} ranges Array of range entries to intersect.
 * @returns {IntersectionResult} The intersection result with any conflicts.
 */
export function computeIntersection(ranges: RangeEntry[]): IntersectionResult {
  const valid = ranges.filter(r => r.range !== '*' && semver.validRange(r.range) !== null)

  if (valid.length === 0) {
    return { intersection: null, conflicts: [] }
  }

  // Sort by minimum version ascending for deterministic greedy pass
  const sorted = [...valid].sort((a, b) => {
    const minA = semver.minVersion(a.range)
    const minB = semver.minVersion(b.range)
    if (!minA && !minB) return 0
    if (!minA) return 1
    if (!minB) return -1
    return semver.compare(minA, minB)
  })

  const conflicts: RangeEntry[] = []
  let combined = sorted[0].range

  for (let i = 1; i < sorted.length; i++) {
    const entry = sorted[i]
    if (!semver.intersects(combined, entry.range)) {
      conflicts.push(entry)
    } else {
      combined = `${combined} ${entry.range}`
    }
  }

  if (conflicts.length > 0) {
    return { intersection: null, conflicts }
  }

  return { intersection: semver.validRange(combined), conflicts: [] }
}
