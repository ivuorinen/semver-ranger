import type { Package } from '../types.js'
import { getVersionData, setVersionData, getLatestData, setLatestData } from '../cache/index.js'

const REGISTRY = 'https://registry.npmjs.org'
const CONCURRENCY = 8

interface ResolveOptions {
  offline: boolean
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
 * @returns {Promise<RegistryManifest | null>} Manifest data or null on failure.
 */
async function fetchManifest(name: string, version: string): Promise<RegistryManifest | null> {
  const cacheKey = `${name}@${version}`
  const cached = getVersionData(cacheKey)
  if (cached) return cached

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
 * @returns {Promise<(RegistryManifest & { version: string }) | null>} Latest manifest or null.
 */
async function fetchLatest(name: string): Promise<(RegistryManifest & { version: string }) | null> {
  const cached = getLatestData(name)
  if (cached) return cached

  try {
    const url = `${REGISTRY}/${encodeName(name)}/latest`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as RegistryManifest & { version: string }
    const entry = {
      version: data.version ?? '',
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
 * @returns {Promise<Package[]>} Packages enriched with registry data.
 */
async function processBatch(batch: Package[]): Promise<Package[]> {
  return Promise.all(
    batch.map(async pkg => {
      const [current, latest] = await Promise.all([
        fetchManifest(pkg.name, pkg.version),
        fetchLatest(pkg.name)
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
  if (options.offline) return packages

  const result: Package[] = []
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY)
    const resolved = await processBatch(batch)
    result.push(...resolved)
  }
  return result
}
