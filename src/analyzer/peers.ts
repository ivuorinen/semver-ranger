import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Package, AnalysisTarget, RangeEntry } from '../types.js'
import { computeIntersection } from './intersect.js'

export const WELL_KNOWN_PEERS = [
  'typescript',
  'react',
  'react-dom',
  'vue',
  'svelte',
  'webpack',
  'vite',
  'rollup',
  'esbuild',
  'jest',
  'vitest',
  'next',
  'nuxt',
  'astro'
] as const

/**
 * Detects well-known peer dependency targets from the project's package.json.
 * @param {string} projectDir Path to the project root directory.
 * @param {string[]} extraChecks Additional package names to always include.
 * @returns {string[]} Deduplicated list of peer dependency target names.
 */
export function detectPeerTargets(projectDir: string, extraChecks: string[]): string[] {
  const targets = new Set<string>(extraChecks)

  try {
    const content = readFileSync(join(projectDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    }
    for (const name of WELL_KNOWN_PEERS) {
      if (name in allDeps) {
        targets.add(name)
      }
    }
  } catch {
    // no package.json or unreadable — return extraChecks only
  }

  return Array.from(targets)
}

/**
 * Analyzes peer dependency constraints across all packages for given targets.
 * @param {Package[]} packages The full list of resolved packages.
 * @param {string[]} peerTargets Package names to analyze as peer targets.
 * @returns {AnalysisTarget[]} Array of analysis targets with intersection results.
 */
export function analyzePeers(packages: Package[], peerTargets: string[]): AnalysisTarget[] {
  const results: AnalysisTarget[] = []

  for (const targetName of peerTargets) {
    const ranges: RangeEntry[] = []
    const latestRanges: RangeEntry[] = []

    for (const pkg of packages) {
      const range = pkg.peerDependencies?.[targetName]
      if (typeof range !== 'undefined' && range !== '*') {
        ranges.push({ package: pkg.name, version: pkg.version, range })
      }
      const latestRange = pkg.latestPeerDependencies?.[targetName]
      if (typeof latestRange !== 'undefined' && latestRange !== '*') {
        latestRanges.push({
          package: pkg.name,
          version: pkg.latestVersion ?? pkg.version,
          range: latestRange
        })
      }
    }

    if (ranges.length === 0 && latestRanges.length === 0) continue

    const { intersection, conflicts } = computeIntersection(ranges)
    const { intersection: latestIntersection, conflicts: latestConflicts } =
      computeIntersection(latestRanges)

    results.push({
      name: targetName,
      source: 'peerDependencies',
      ranges,
      intersection,
      conflicts,
      latestRanges,
      latestIntersection,
      latestConflicts
    })
  }

  return results
}
