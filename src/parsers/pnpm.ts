import { parse as parseYaml } from 'yaml'
import type { Package } from '../types.js'

interface PnpmLock {
  lockfileVersion?: string | number
  packages?: Record<string, PnpmPackageEntry>
  snapshots?: Record<string, PnpmPackageEntry>
}

interface PnpmPackageEntry {
  resolution?: Record<string, string>
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  dev?: boolean
}

/**
 * Extracts the package name and version from a pnpm lockfile key.
 * Handles both v6 format (/pkg@1.0.0) and v9 format (pkg@1.0.0).
 * @param {string} key The raw package key from the lockfile.
 * @returns {{ name: string; version: string } | null} Parsed name/version or null.
 */
function extractNameVersion(key: string): { name: string; version: string } | null {
  // Strip peer dep suffix: /pkg@1.0.0(react@18.0.0) -> /pkg@1.0.0
  const stripped = key.replace(/\([^)]*\)/gu, '').trim()

  // v6: "/pkg@1.0.0" or "/@scope/pkg@1.0.0"
  const v6Match = stripped.match(/^\/(@[^/]+\/[^@]+|[^@/][^@]*)@(.+)$/u)
  if (v6Match) {
    return { name: v6Match[1], version: v6Match[2] }
  }

  // v9: "pkg@1.0.0" or "@scope/pkg@1.0.0"
  const v9Match = stripped.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/u)
  if (v9Match) {
    return { name: v9Match[1], version: v9Match[2] }
  }

  return null
}

/**
 * Parses a pnpm lockfile (v6 or v9) and returns a list of packages.
 * @param {string} content The raw YAML string content of the pnpm-lock.yaml file.
 * @returns {Package[]} Array of parsed packages with version and engine info.
 */
export function parsePnpmLockfile(content: string): Package[] {
  const lock = parseYaml(content) as PnpmLock

  const metaBlock = lock.packages ?? {}
  const versionBlock = lock.snapshots ?? lock.packages ?? {}
  const result: Package[] = []
  const seen = new Set<string>()

  for (const [key] of Object.entries(versionBlock)) {
    const parsed = extractNameVersion(key)
    if (!parsed) continue
    const { name, version } = parsed

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    const meta = metaBlock[key] ?? {}

    result.push({
      name,
      version,
      engines: meta.engines,
      peerDependencies: meta.peerDependencies
    })
  }

  return result
}
