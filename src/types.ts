export interface Package {
  /** Registry name; for an aliased dependency this is the real package, not the alias */
  name: string
  version: string
  /** Directory under node_modules, when that differs from the registry name */
  alias?: string
  /**
   * A workspace member or a git, file or tarball source. A registry lookup could
   * only fail or find an unrelated package, and would disclose the name.
   */
  unpublished?: boolean
  /** Constraints are known, so an absent field means none were declared */
  hasMetadata?: boolean
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
  /**
   * The latest release, all from one registry answer. Separate optional fields
   * implied a latest constraint could exist without a version, and the fallback
   * written for that case was a branch no test could reach.
   */
  latest?: {
    version: string
    engines?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
}

export interface RangeEntry {
  package: string
  version: string
  range: string
}

export interface AnalysisTarget {
  name: string
  source: 'engines' | 'peerDependencies'
  /** Ranges from currently installed versions */
  ranges: RangeEntry[]
  /**
   * Computed safe range for installed versions; null on a conflict (see conflicts)
   * or when no installed version declares a valid range
   */
  intersection: string | null
  /** Entries that break the installed intersection */
  conflicts: RangeEntry[]
  /** Installed entries whose range string is not valid semver */
  invalidRanges: RangeEntry[]
  /** Ranges from latest available versions */
  latestRanges: RangeEntry[]
  /**
   * Computed safe range for latest versions; null on a conflict (see latestConflicts)
   * or when no latest release declares a valid range
   */
  latestIntersection: string | null
  /** Entries that break the latest intersection */
  latestConflicts: RangeEntry[]
  /** Latest entries whose range string is not valid semver */
  latestInvalidRanges: RangeEntry[]
}

export interface NameVersion {
  name: string
  version: string
}

export interface PackageVersion {
  version: string
}

export interface PackageDeps {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  /** Workspace globs, either directly or under `packages` */
  workspaces?: string[] | { packages?: string[] }
}

export type LockfileType = 'npm' | 'yarn-classic' | 'yarn-berry' | 'pnpm'
export type ManagerType = 'npm' | 'yarn' | 'pnpm'

export interface DetectedLockfile {
  path: string
  type: LockfileType
  manager: ManagerType
}
