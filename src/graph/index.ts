import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Package, LockfileType, PackageDeps } from '../types.js'

interface NpmLockPackageEntry {
  dependencies?: Record<string, string>
}

interface NpmLockDependencyEntry {
  requires?: Record<string, string>
}

interface NpmLock {
  lockfileVersion?: number
  packages?: Record<string, NpmLockPackageEntry>
  dependencies?: Record<string, NpmLockDependencyEntry>
}

interface PnpmLockPackageEntry {
  dependencies?: Record<string, string>
}

interface PnpmLock {
  packages?: Record<string, PnpmLockPackageEntry>
}

/**
 * Builds a map from package name to list of direct dependency names.
 * @param {string} content Raw lockfile content.
 * @param {LockfileType} type The lockfile format.
 * @returns {Map<string, string[]>} Map of package name to dependency names.
 */
export function buildEdgeMap(content: string, type: LockfileType): Map<string, string[]> {
  const edges = new Map<string, string[]>()

  if (type === 'npm') {
    const lock = JSON.parse(content) as NpmLock

    if (typeof lock.packages !== 'undefined') {
      // v2/v3: use packages["node_modules/X"].dependencies
      for (const [key, entry] of Object.entries(lock.packages)) {
        if (!key.startsWith('node_modules/')) continue
        const name = key.slice('node_modules/'.length)
        edges.set(name, Object.keys(entry.dependencies ?? {}))
      }
    } else {
      // v1: use dependencies["X"].requires
      for (const [name, entry] of Object.entries(lock.dependencies ?? {})) {
        edges.set(name, Object.keys(entry.requires ?? {}))
      }
    }
  } else if (type === 'pnpm') {
    const lock = parseYaml(content) as PnpmLock
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      const stripped = key.replace(/\([^)]*\)/gu, '').trim()
      const match =
        stripped.match(/^\/(@[^/]+\/[^@]+|[^@/][^@]*)@/u) ??
        stripped.match(/^(@[^/]+\/[^@]+|[^@]+)@/u)
      /* c8 ignore next */
      if (match === null) continue
      const name = match[1]
      edges.set(name, Object.keys(entry.dependencies ?? {}))
    }
  } else if (type === 'yarn-classic') {
    let currentPkg: string | null = null
    let inDeps = false
    const deps: string[] = []
    for (const line of content.split('\n')) {
      if (!line.startsWith(' ') && line.match(/^"?[^#]/u) !== null) {
        if (currentPkg !== null) edges.set(currentPkg, [...deps])
        const m = line.match(/^"?(@[^/"\s]+\/[^@"\s]+|[^@"\s]+)@/u)
        currentPkg = m !== null ? m[1] : /* c8 ignore next */ null
        inDeps = false
        deps.length = 0
      } else if (line.trim() === 'dependencies:') {
        inDeps = true
      } else if (inDeps && line.match(/^ {4}"?[^" ]/u) !== null) {
        const m = line.match(/^ {4}"?([^"\s]+)\s/u)
        if (m !== null) deps.push(m[1])
        /* c8 ignore next 3 */
      } else if (inDeps && line.trim() === '') {
        inDeps = false
      }
    }
    if (currentPkg !== null) edges.set(currentPkg, [...deps])
  }
  // yarn-berry: skip (complex symlink format; fall back to no-op)

  return edges
}

/**
 * BFS from root package names, returning all reachable package names.
 * @param {string[]} roots Starting package names.
 * @param {Map<string, string[]>} edges Adjacency map from buildEdgeMap.
 * @returns {Set<string>} All reachable package names including roots.
 */
function bfs(roots: string[], edges: Map<string, string[]>): Set<string> {
  const visited = new Set<string>()
  const queue = [...roots]
  let qi = 0
  while (qi < queue.length) {
    const name = queue[qi++]
    if (visited.has(name)) continue
    visited.add(name)
    for (const dep of edges.get(name) ?? /* c8 ignore next */ []) {
      if (!visited.has(dep)) queue.push(dep)
    }
  }
  return visited
}

/**
 * Filters packages to exclude those reachable only via devDependencies.
 * Reads package.json from projectDir to identify prod vs dev roots.
 * Falls back to returning all packages if package.json is unreadable.
 * @param {Package[]} packages All packages from lockfile.
 * @param {string} projectDir Directory containing package.json.
 * @param {string} lockfileContent Raw lockfile content.
 * @param {LockfileType} lockfileType The lockfile format.
 * @returns {Package[]} Filtered package list with dev-only packages removed.
 */
export function filterDevPackages(
  packages: Package[],
  projectDir: string,
  lockfileContent: string,
  lockfileType: LockfileType
): Package[] {
  let pkgJson: PackageDeps
  try {
    const raw = readFileSync(join(projectDir, 'package.json'), 'utf8')
    pkgJson = JSON.parse(raw) as PackageDeps
  } catch {
    return packages
  }

  const prodRoots = Object.keys(pkgJson.dependencies ?? {})
  const devRoots = Object.keys(pkgJson.devDependencies ?? {})

  const edges = buildEdgeMap(lockfileContent, lockfileType)
  const productionSet = bfs(prodRoots, edges)
  const devReachable = bfs(devRoots, edges)

  const devOnlySet = new Set<string>()
  for (const name of devReachable) {
    if (!productionSet.has(name)) devOnlySet.add(name)
  }

  return packages.filter(p => !devOnlySet.has(p.name))
}
