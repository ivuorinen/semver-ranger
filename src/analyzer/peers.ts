import type { Package, AnalysisTarget, PackageDeps } from '../types.ts'
import { analyzeTarget } from './intersect.ts'

const WELL_KNOWN_PEERS = [
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
 * @param {PackageDeps | null} manifest The project's parsed package.json, if it has one.
 * @param {string[]} extraChecks Additional package names to always include.
 * @returns {string[]} Deduplicated list of peer dependency target names.
 */
export function detectPeerTargets(manifest: PackageDeps | null, extraChecks: string[]): string[] {
  const targets = new Set<string>(extraChecks)
  const allDeps = { ...manifest?.dependencies, ...manifest?.devDependencies }
  for (const name of WELL_KNOWN_PEERS) {
    if (name in allDeps) {
      targets.add(name)
    }
  }
  return Array.from(targets)
}

/**
 * Analyzes peer dependency constraints across all packages for given targets.
 * Only a package's own keys count: a target named by --check, such as
 * constructor, otherwise read an inherited Object member as a declared range.
 * @param {Package[]} packages The full list of resolved packages.
 * @param {string[]} peerTargets Package names to analyze as peer targets.
 * @returns {AnalysisTarget[]} Array of analysis targets with intersection results.
 */
export function analyzePeers(packages: Package[], peerTargets: string[]): AnalysisTarget[] {
  return peerTargets.flatMap(
    target =>
      analyzeTarget(
        packages,
        target,
        'peerDependencies',
        declared => Object.getOwnPropertyDescriptor(declared.peerDependencies ?? {}, target)?.value
      ) ?? []
  )
}
