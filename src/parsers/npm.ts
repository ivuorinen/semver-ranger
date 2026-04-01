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

type NpmLock = NpmLockV1 | NpmLockV2V3

/**
 * Parses an npm package-lock.json file and returns a list of packages.
 * Supports lockfile versions 1, 2, and 3.
 * @param {string} content The raw JSON string content of the lockfile.
 * @returns {Package[]} Array of parsed packages with version and engine info.
 */
export function parseNpmLockfile(content: string): Package[] {
  const lock = JSON.parse(content) as NpmLock

  if (lock.lockfileVersion >= 2) {
    const v2 = lock as NpmLockV2V3
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

  // v1 fallback
  const v1 = lock as NpmLockV1
  return Object.entries(v1.dependencies ?? {}).map(([name, dep]) => ({
    name,
    version: dep.version
  }))
}
