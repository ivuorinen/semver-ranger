import type { Package } from '../types.js'

interface NpmLockV1 {
  lockfileVersion: 1
  dependencies?: Record<string, { version: string }>
}

interface NpmLockV2V3 {
  lockfileVersion: 2 | 3
  packages?: Record<
    string,
    {
      version?: string
      name?: string
      engines?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
  >
}

interface NpmLockUnknown {
  lockfileVersion?: unknown
}

/**
 * Parses an npm package-lock.json file and returns a list of packages.
 * Supports lockfile versions 1, 2, and 3.
 *
 * The version is validated rather than inferred: a missing or non-numeric
 * `lockfileVersion` used to fall through to the v1 shape, which reads
 * `dependencies` and so returned an empty list for anything that was not a v1
 * lockfile — reporting a malformed file as one with no dependencies.
 * @param {string} content The raw JSON string content of the lockfile.
 * @returns {Package[]} Array of parsed packages with version and engine info.
 * @throws {Error} If lockfileVersion is missing, non-numeric, or unsupported.
 */
export function parseNpmLockfile(content: string): Package[] {
  const parsed = JSON.parse(content) as NpmLockUnknown
  const lockfileVersion = parsed.lockfileVersion

  if (typeof lockfileVersion !== 'number' || !Number.isFinite(lockfileVersion)) {
    throw new Error('unrecognised package-lock.json: expected a numeric "lockfileVersion" field')
  }

  if (lockfileVersion === 2 || lockfileVersion === 3) {
    const v2 = parsed as NpmLockV2V3
    const result: Package[] = []
    const seen = new Map<string, boolean>()
    for (const [key, entry] of Object.entries(v2.packages ?? {})) {
      if (key === '') continue // skip root
      const nameParts = key.split('node_modules/')
      const name = nameParts.at(-1)
      /* c8 ignore next */
      if (typeof name === 'undefined' || typeof entry.version === 'undefined') continue
      const dedupKey = `${name}@${entry.version}`
      if (seen.has(dedupKey)) continue
      seen.set(dedupKey, true)
      result.push({
        name,
        version: entry.version,
        engines: entry.engines,
        peerDependencies: entry.peerDependencies
      })
    }
    return result
  }

  if (lockfileVersion === 1) {
    const v1 = parsed as NpmLockV1
    return Object.entries(v1.dependencies ?? {}).map(([name, dep]) => ({
      name,
      version: dep.version
    }))
  }

  throw new Error(`unsupported package-lock.json lockfileVersion: ${String(lockfileVersion)}`)
}
