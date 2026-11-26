import semver from 'semver'
import type { AnalysisTarget, Package, RangeEntry } from '../types.ts'

interface IntersectionResult {
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
    if (comp.operator === '>=') {
      gteVersions.push(comp.semver)
    } else if (comp.operator === '<') {
      ltVersions.push(comp.semver)
    } else if (comp.value !== '') {
      others.push(comp.value)
    }
  }

  const parts: string[] = []
  const [highestLower] = gteVersions.toSorted((a, b) => semver.compare(b, a))
  if (typeof highestLower !== 'undefined') parts.push(`>=${highestLower.version}`)
  const [lowestUpper] = ltVersions.toSorted((a, b) => semver.compare(a, b))
  if (typeof lowestUpper !== 'undefined') parts.push(`<${lowestUpper.version}`)
  parts.push(...new Set(others))
  return parts.length > 0 ? parts.join(' ') : '*'
}

/**
 * Simplifies a well-formed range by simplifying each OR-group and deduplicating groups.
 * @param {string} rangeStr Range string to simplify.
 * @returns {string} Simplified range string.
 */
function simplifyRange(rangeStr: string): string {
  const groups = new semver.Range(rangeStr).set.map(simplifyGroup)
  return [...new Set(groups)].join(' || ')
}

/**
 * Names the release a comparator opens to prereleases.
 * @param {semver.Comparator} comp The comparator.
 * @returns {string | null} The `major.minor.patch`, or null if it names no prerelease.
 */
function prereleaseRelease(comp: semver.Comparator): string | null {
  if (comp.value === '' || comp.semver.prerelease.length === 0) return null
  const { major, minor, patch } = comp.semver
  return `${String(major)}.${String(minor)}.${String(patch)}`
}

/**
 * Combines two AND-groups, keeping prereleases only where both allow them.
 *
 * semver matches a prerelease only if a comparator in the same group names a
 * prerelease of that release, so `>=1.0.0` rejects `2.0.0-beta`. Keeping the
 * tightest bounds of `^2.0.0-alpha` and `>=1.0.0` would let `>=2.0.0-alpha`
 * extend that permission to the side that withheld it. A comparator without the
 * other side's agreement is restated to exclude its release's prereleases.
 * @param {readonly semver.Comparator[]} a One group.
 * @param {readonly semver.Comparator[]} b The other group.
 * @returns {semver.Comparator[] | null} The comparators, or null if nothing can match.
 */
function andGroups(
  a: readonly semver.Comparator[],
  b: readonly semver.Comparator[]
): semver.Comparator[] | null {
  const inA = new Set(a.map(prereleaseRelease))
  const inB = new Set(b.map(prereleaseRelease))
  const combined: semver.Comparator[] = []

  for (const comp of [...a, ...b]) {
    const release = prereleaseRelease(comp)
    if (release === null || (inA.has(release) && inB.has(release))) {
      combined.push(comp)
    } else if (comp.operator === '') {
      // An exact prerelease can only ever match that prerelease.
      return null
    } else {
      combined.push(
        new semver.Comparator(comp.operator.startsWith('>') ? `>=${release}` : `<${release}-0`)
      )
    }
  }

  return combined
}

/**
 * Computes the logical AND of two semver ranges as a new range string.
 *
 * Range strings must never be intersected by concatenation: in semver grammar
 * `||` binds looser than the space (AND) operator, so `"A || B" + " " + "C"`
 * parses as `A || (B C)` rather than `(A || B) AND C`. Instead the AND is
 * distributed across both OR-sets and unsatisfiable groups are dropped.
 *
 * Each group is simplified before deduplicating. Overlapping OR-groups otherwise
 * all survive, so the range doubled with every package declaring one and about
 * 30 such packages stopped the run from finishing.
 * @param {string} a Left-hand range.
 * @param {string} b Right-hand range.
 * @returns {string | null} Combined range, or null if the two ranges are disjoint.
 */
function andRanges(a: string, b: string): string | null {
  const groups = new Set<string>()

  for (const groupA of new semver.Range(a).set) {
    for (const groupB of new semver.Range(b).set) {
      const combined = andGroups(groupA, groupB)
      if (combined === null) continue
      const group = simplifyGroup(combined)
      // minVersion is null exactly when the group is unsatisfiable (e.g. ">=18 <17")
      if (semver.minVersion(group) === null) continue
      groups.add(group)
    }
  }

  return groups.size === 0 ? null : [...groups].join(' || ')
}

/**
 * Drops a range's unsatisfiable OR-groups.
 *
 * Each group is checked on its own, as andRanges checks the groups it builds:
 * semver.minVersion over a whole range tests only the lowest group's candidate.
 * A group keeps its own comparators, so its prerelease permissions survive.
 * @param {string} range A valid range.
 * @returns {string | null} The satisfiable groups, or null when there are none.
 */
function liveGroups(range: string): string | null {
  const groups = new semver.Range(range).set
    .map(simplifyGroup)
    .filter(group => semver.minVersion(group) !== null)
  return groups.length === 0 ? null : [...new Set(groups)].join(' || ')
}

interface GreedyRun {
  combined: string
  accepted: RangeEntry[]
  conflicts: RangeEntry[]
}

/**
 * Greedily folds entries into one range, starting from a chosen seed.
 *
 * Each normalized range is decided once per run. Once a range is accepted,
 * every later combined range lies inside it; once rejected, every later one lies
 * inside the range it failed against. So entries sharing a range always get the
 * same verdict, and folding each of them again cost one semver intersection per
 * package per seed: seconds on large lockfiles where ranges conflict.
 *
 * The seed loses its unsatisfiable OR-groups first, as every folded entry does
 * in andRanges. Kept verbatim, a dead lowest group made semver.minVersion call
 * the whole range unsatisfiable, so a lone package declaring `>=20 <18 || >=22`
 * was reported as conflicting with itself.
 * @param {RangeEntry} seed The entry to start from; always accepted.
 * @param {RangeEntry[]} entries All entries, in a stable order.
 * @returns {GreedyRun} The combined range plus the accepted and rejected entries.
 */
function greedyFrom(seed: RangeEntry, entries: RangeEntry[]): GreedyRun {
  // A fully unsatisfiable seed keeps its text, so computeIntersection still blames it.
  let combined = liveGroups(seed.range) ?? seed.range
  const accepted: RangeEntry[] = [seed]
  const conflicts: RangeEntry[] = []
  const verdicts = new Map<string, boolean>()

  for (const entry of entries) {
    if (entry === seed) continue
    // semver caches parsed ranges, so normalizing again per run stays cheap.
    const key = new semver.Range(entry.range).range
    if (!verdicts.has(key)) {
      const next = andRanges(combined, entry.range)
      if (next !== null) combined = next
      verdicts.set(key, next !== null)
    }
    if (verdicts.get(key) === true) accepted.push(entry)
    else conflicts.push(entry)
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
    const key = new semver.Range(entry.range).range
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

  // Sort by minimum version ascending for deterministic greedy pass
  const sorted = [...valid].sort((a, b) => {
    const minA = semver.minVersion(a.range)
    const minB = semver.minVersion(b.range)
    if (minA === null && minB === null) return 0
    if (minA === null) return 1
    if (minB === null) return -1
    // Equal minimums fall back to the text, or input order would pick the first seed.
    // By code unit, not localeCompare: collation follows the user's locale (Danish
    // puts X before x), so two machines could order the same lockfile differently.
    return semver.compare(minA, minB) || Number(a.range > b.range) - Number(a.range < b.range)
  })

  const [first] = sorted
  if (typeof first === 'undefined') {
    return { intersection: null, conflicts: [], invalid }
  }

  let best = greedyFrom(first, sorted)

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
      if (seed === first) continue
      const run = greedyFrom(seed, sorted)
      if (run.accepted.length > best.accepted.length) {
        best = run
      }
    }
  }

  // The seed is accepted unchecked, so when every range is unsatisfiable the
  // winning seed would escape blame, or be reported as the safe range if alone.
  if (semver.minVersion(best.combined) === null) {
    return { intersection: null, conflicts: [...best.accepted, ...best.conflicts], invalid }
  }

  if (best.conflicts.length > 0) {
    return { intersection: null, conflicts: best.conflicts, invalid }
  }

  return { intersection: simplifyRange(best.combined), conflicts: [], invalid }
}

/**
 * Renders a declared constraint as text.
 *
 * Manifests are not validated, so a value can be a number or null. The prefix
 * keeps such a value out of the intersection and visible as unparseable; passed
 * through as it was, it crashed the table renderer and lost the whole run.
 * @param {unknown} value The declared constraint.
 * @returns {string} The range text.
 */
function rangeText(value: unknown): string {
  return typeof value === 'string' ? value : `not a string: ${String(value)}`
}

/**
 * Tells whether a declared value constrains anything.
 * @param {unknown} value The value from a manifest.
 * @returns {boolean} False when absent or the unconstrained wildcard.
 */
function isConstraint(value: unknown): boolean {
  return typeof value !== 'undefined' && value !== '*'
}

/**
 * Analyzes one target across all packages, at installed and latest versions.
 *
 * Latest data belongs to a package name, so it is collected once per name. One
 * entry per installed version let a package with several copies outvote
 * separate packages in the conflict search.
 * @param {Package[]} packages The full list of resolved packages.
 * @param {string} name The target's name, such as "node" or "react".
 * @param {AnalysisTarget['source']} source Where the constraints come from.
 * @param {Function} pick Reads the constraint from a package or its latest release;
 * one reader for both keeps the two sides from reading different fields.
 * @returns {AnalysisTarget | null} The analysis, or null if no package declares one.
 */
export function analyzeTarget(
  packages: Package[],
  name: string,
  source: AnalysisTarget['source'],
  pick: (declared: Pick<Package, 'engines' | 'peerDependencies'>) => unknown
): AnalysisTarget | null {
  const ranges: RangeEntry[] = []
  const latestRanges: RangeEntry[] = []
  const latestSeen = new Set<string>()

  for (const pkg of packages) {
    const installed = pick(pkg)
    if (isConstraint(installed)) {
      ranges.push({ package: pkg.name, version: pkg.version, range: rangeText(installed) })
    }
    if (typeof pkg.latest === 'undefined' || latestSeen.has(pkg.name)) continue
    const latest = pick(pkg.latest)
    if (isConstraint(latest)) {
      latestSeen.add(pkg.name)
      latestRanges.push({
        package: pkg.name,
        version: pkg.latest.version,
        range: rangeText(latest)
      })
    }
  }

  if (ranges.length === 0 && latestRanges.length === 0) return null

  const { intersection, conflicts, invalid } = computeIntersection(ranges)
  const {
    intersection: latestIntersection,
    conflicts: latestConflicts,
    invalid: latestInvalid
  } = computeIntersection(latestRanges)

  return {
    name,
    source,
    ranges,
    intersection,
    conflicts,
    invalidRanges: invalid,
    latestRanges,
    latestIntersection,
    latestConflicts,
    latestInvalidRanges: latestInvalid
  }
}
