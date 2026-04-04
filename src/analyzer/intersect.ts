import semver from 'semver'
import type { RangeEntry } from '../types.js'

export interface IntersectionResult {
  intersection: string | null
  conflicts: RangeEntry[]
}

/**
 * Removes ranges that are supersets of other ranges.
 * If A ⊂ B (A is more restrictive), B is redundant and removed.
 * @param {string[]} ranges Normalized semver range strings to filter.
 * @returns {string[]} Ranges with redundant supersets removed.
 */
function filterSubsumed(ranges: string[]): string[] {
  return ranges.filter(
    (range, i) =>
      !ranges.some((other, j) => i !== j && other !== range && semver.subset(other, range))
  )
}

/**
 * Simplifies a combined range by deduplicating comparators within each OR-set.
 * For >= comparators, keeps only the highest. For < comparators, keeps only the lowest.
 * @param {string} rangeStr Combined semver range string to simplify.
 * @returns {string} Simplified range string with redundant comparators removed.
 */
function simplifyComparators(rangeStr: string): string {
  try {
    const range = new semver.Range(rangeStr)
    const simplified = range.set.map(comparators => {
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
      parts.push(...others)
      return parts.join(' ')
    })
    return simplified.join(' || ')
  } catch {
    return rangeStr
  }
}

/**
 * Computes the semver intersection of multiple range entries.
 * Returns null intersection with conflicts if ranges are disjoint.
 * Deduplicates and simplifies the result by removing subsumed ranges.
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
    if (minA === null && minB === null) return 0
    if (minA === null) return 1
    if (minB === null) return -1
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

  // Deduplicate normalized range strings, then remove subsumed ranges
  const unique = [
    ...new Set(
      sorted.filter(e => !conflicts.includes(e)).map(e => semver.validRange(e.range) ?? e.range)
    )
  ]
  const simplified = filterSubsumed(unique)

  return { intersection: simplifyComparators(simplified.join(' ')), conflicts: [] }
}
