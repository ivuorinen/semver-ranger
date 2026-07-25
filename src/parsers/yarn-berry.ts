import { parseSyml } from '@yarnpkg/parsers'
import type { Package } from '../types.js'

interface YarnBerryEntry {
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Parses a Yarn Berry (v2+) lockfile and returns a list of packages.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Package[]} Array of parsed packages with name and version.
 */
export function parseYarnBerryLockfile(content: string): Package[] {
  const parsed = parseSyml(content) as Record<string, YarnBerryEntry>

  const seen = new Map<string, boolean>()
  const result: Package[] = []

  for (const [key, entry] of Object.entries(parsed)) {
    if (key === '__metadata') continue

    // key format: "pkg@npm:^1.0.0" or "@scope/pkg@npm:^1.0.0"
    const nameMatch = key.match(/^(.+?)@(?:npm|patch|portal|link|file|git):/u)
    if (nameMatch === null) continue
    const name = nameMatch[1]
    const version = entry.version
    if (typeof version === 'undefined' || version === '') continue

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.set(dedupKey, true)

    // Berry lockfiles record peerDependencies but not engines; engines come
    // from the registry/local pass.
    result.push({ name, version, peerDependencies: entry.peerDependencies })
  }

  return result
}
