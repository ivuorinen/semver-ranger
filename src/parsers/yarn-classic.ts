import lockfile from '@yarnpkg/lockfile'
import type { Package } from '../types.js'

/**
 * Parses a Yarn Classic (v1) lockfile and returns a list of packages.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Package[]} Array of parsed packages with name and version.
 * @throws {Error} If the lockfile cannot be parsed successfully.
 */
export function parseYarnClassicLockfile(content: string): Package[] {
  const parsed = lockfile.parse(content)
  if (parsed.type !== 'success') {
    throw new Error(`Failed to parse yarn classic lockfile: ${parsed.type}`)
  }

  const seen = new Map<string, string>() // name@version -> true
  const result: Package[] = []

  for (const [key, entry] of Object.entries(parsed.object)) {
    // key may be "pkg@^1.0.0" or "pkg@^1.0.0, pkg@^1.1.0" (merged)
    // extract the package name from the first specifier
    const firstSpec = key.split(',')[0].trim()
    const nameMatch = firstSpec.match(/^(@[^/]+\/[^@]+|[^@]+)@/u)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const version = (entry as { version: string }).version
    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.set(dedupKey, version)
    result.push({ name, version })
  }

  return result
}
