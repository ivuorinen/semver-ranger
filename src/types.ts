export interface Package {
  name: string
  version: string
  latestVersion?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
  latestEngines?: Record<string, string>
  latestPeerDependencies?: Record<string, string>
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
  /** Computed safe range for installed versions; null if conflict */
  intersection: string | null
  /** Entries that break the installed intersection */
  conflicts: RangeEntry[]
  /** Ranges from latest available versions */
  latestRanges: RangeEntry[]
  /** Computed safe range for latest versions; null if conflict */
  latestIntersection: string | null
  /** Entries that break the latest intersection */
  latestConflicts: RangeEntry[]
}

export interface ResolvedLockfile {
  lockfilePath: string
  lockfileType: LockfileType
  manager: ManagerType
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
}

export interface CliOptions {
  lockfilePath?: string
  offline: boolean
  check: string[]
  noDev: boolean
  all: boolean
  json: boolean
}

export type LockfileType = 'npm' | 'yarn-classic' | 'yarn-berry' | 'pnpm'
export type ManagerType = 'npm' | 'yarn' | 'pnpm'

export interface DetectedLockfile {
  path: string
  type: LockfileType
  manager: ManagerType
}
