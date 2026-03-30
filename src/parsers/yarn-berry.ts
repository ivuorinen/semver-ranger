import { parseSyml } from '@yarnpkg/parsers'
import type { Package } from '../types.js'

/**
 * Parses a Yarn Berry (v2+) lockfile and returns a list of packages.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Package[]} Array of parsed packages with name and version.
 */
export function parseYarnBerryLockfile(content: string): Package[] {
  const parsed = parseSyml(content) as Record<string, Record<string, string>>

  const seen = new Map<string, boolean>()
  const result: Package[] = []

  for (const [key, entry] of Object.entries(parsed)) {
    if (key === '__metadata') continue

    // key format: "pkg@npm:^1.0.0" or "@scope/pkg@npm:^1.0.0"
    const nameMatch = key.match(/^(.+?)@(?:npm|patch|portal|link|file|git):/u)
    if (!nameMatch) continue
    const name = nameMatch[1]
    const version = entry.version
    if (!version) continue

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.set(dedupKey, true)

    result.push({ name, version })
  }

  return result
}
