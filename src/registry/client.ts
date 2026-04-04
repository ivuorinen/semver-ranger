import type { Package } from '../types.js'
import { getVersionData, setVersionData, getLatestData, setLatestData } from '../cache/index.js'

const REGISTRY = 'https://registry.npmjs.org'
// CONCURRENCY is per-package; each package triggers 2 parallel fetches
// (fetchManifest + fetchLatest), so actual max requests = CONCURRENCY * 2.
// Set to 4 so we stay within ~8 total concurrent network requests.
const CONCURRENCY = 4

interface ResolveOptions {
  offline: boolean
  onProgress?: (completed: number, total: number, cached: number) => void
}

interface CacheCounter {
  cached: number
}

interface RegistryManifest {
  version?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Encodes a package name for use in npm registry URLs.
 * @param {string} name The package name (possibly scoped).
 * @returns {string} URL-encoded package name.
 */
function encodeName(name: string): string {
  // scoped: @scope/name -> @scope%2Fname
  return name.startsWith('@') ? name.replace('/', '%2F') : name
}

/**
 * Fetches manifest data for a specific package version from the registry.
 * @param {string} name The package name.
 * @param {string} version The package version.
 * @param {{ cached: number }} counter Mutable counter tracking cache hits.
 * @param {number} counter.cached Number of cache hits so far.
 * @returns {Promise<RegistryManifest | null>} Manifest data or null on failure.
 */
async function fetchManifest(
  name: string,
  version: string,
  counter: CacheCounter
): Promise<RegistryManifest | null> {
  const cacheKey = `${name}@${version}`
  const cached = getVersionData(cacheKey)
  if (cached !== null) {
    counter.cached++
    return cached
  }

  try {
    const url = `${REGISTRY}/${encodeName(name)}/${version}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as RegistryManifest
    const manifest = {
      engines: data.engines,
      peerDependencies: data.peerDependencies
    }
    setVersionData(cacheKey, manifest)
    return manifest
  } catch {
    return null
  }
}

/**
 * Fetches the latest version manifest for a package from the registry.
 * @param {string} name The package name.
 * @param {{ cached: number }} counter Mutable counter tracking cache hits.
 * @param {number} counter.cached Number of cache hits so far.
 * @returns {Promise<(RegistryManifest & { version: string }) | null>} Latest manifest or null.
 */
async function fetchLatest(
  name: string,
  counter: CacheCounter
): Promise<(RegistryManifest & { version: string }) | null> {
  const cached = getLatestData(name)
  if (cached !== null) {
    counter.cached++
    return cached
  }

  try {
    const url = `${REGISTRY}/${encodeName(name)}/latest`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as RegistryManifest & { version: string }
    if (!data.version) return null
    const entry = {
      version: data.version,
      engines: data.engines,
      peerDependencies: data.peerDependencies
    }
    setLatestData(name, entry)
    return entry
  } catch {
    return null
  }
}

/**
 * Processes a batch of packages by fetching their registry data in parallel.
 * @param {Package[]} batch The batch of packages to process.
 * @param {{ cached: number }} counter Mutable counter tracking cache hits.
 * @param {number} counter.cached Number of cache hits so far.
 * @returns {Promise<Package[]>} Packages enriched with registry data.
 */
async function processBatch(batch: Package[], counter: CacheCounter): Promise<Package[]> {
  return await Promise.all(
    batch.map(async pkg => {
      const [current, latest] = await Promise.all([
        fetchManifest(pkg.name, pkg.version, counter),
        fetchLatest(pkg.name, counter)
      ])
      return {
        ...pkg,
        engines: current?.engines ?? pkg.engines,
        peerDependencies: current?.peerDependencies ?? pkg.peerDependencies,
        latestVersion: latest?.version,
        latestEngines: latest?.engines,
        latestPeerDependencies: latest?.peerDependencies
      }
    })
  )
}

/**
 * Resolves packages against the npm registry, with optional offline mode.
 * @param {Package[]} packages The packages to resolve.
 * @param {ResolveOptions} options Resolution options including offline flag.
 * @returns {Promise<Package[]>} Packages enriched with registry data.
 */
export async function resolveRegistry(
  packages: Package[],
  options: ResolveOptions
): Promise<Package[]> {
  if (options.offline) {
    return packages.map(pkg => {
      const manifest = getVersionData(`${pkg.name}@${pkg.version}`)
      const latest = getLatestData(pkg.name)
      return {
        ...pkg,
        ...(typeof manifest?.engines !== 'undefined' && { engines: manifest.engines }),
        ...(typeof manifest?.peerDependencies !== 'undefined' && {
          peerDependencies: manifest.peerDependencies
        }),
        ...(typeof latest?.version !== 'undefined' && { latestVersion: latest.version }),
        ...(typeof latest?.engines !== 'undefined' && { latestEngines: latest.engines }),
        ...(typeof latest?.peerDependencies !== 'undefined' && {
          latestPeerDependencies: latest.peerDependencies
        })
      }
    })
  }

  const result: Package[] = []
  let completedCount = 0
  const cacheCounter = { cached: 0 }
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY)
    const resolved = await processBatch(batch, cacheCounter)
    result.push(...resolved)
    completedCount += batch.length
    options.onProgress?.(completedCount, packages.length, cacheCounter.cached)
  }
  return result
}
