import type { Package } from '../types.js'
import { getVersionData, setVersionData, getLatestData, setLatestData } from '../cache/index.js'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
// npm exports the resolved .npmrc as npm_config_* env vars under `npm exec`.
const REGISTRY_ENV = 'npm_config_registry'
// CONCURRENCY is per-package; each package triggers 2 parallel fetches
// (fetchManifest + fetchLatest), so actual max requests = CONCURRENCY * 2.
// Set to 4 so we stay within ~8 total concurrent network requests.
const CONCURRENCY = 4
// Node's fetch has no default request timeout; without one a stalled socket
// hangs the whole run behind a spinner that never stops.
const REQUEST_TIMEOUT_MS = 10_000

interface ResolveOptions {
  offline: boolean
  onProgress?: (completed: number, total: number, cached: number) => void
}

interface CacheCounter {
  cached: number
  /** Requests that returned a non-ok status, timed out, or threw */
  failed: number
}

export interface ResolveResult {
  packages: Package[]
  /** Number of registry requests that did not yield data */
  failed: number
}

/**
 * Narrows an environment value to a usable URL string.
 * @param {string | undefined} value Raw environment value.
 * @returns {string | null} The value when it is a non-empty string, else null.
 */
function pickUrl(value: string | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Resolves the registry base URL for a package, honouring npm's scope-aware
 * configuration. npm exports the full .npmrc as npm_config_* when the CLI is
 * launched via `npm exec` / `npx`, so this covers private scopes and mirrors
 * without parsing .npmrc directly.
 * @param {string} name The package name (possibly scoped).
 * @returns {string} Registry base URL without a trailing slash.
 */
export function registryFor(name: string): string {
  const scope = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : null
  const scoped = scope !== null ? process.env[`npm_config_${scope}:registry`] : ''
  const fallback = process.env[REGISTRY_ENV]
  const url = pickUrl(scoped) ?? /* c8 ignore next */ pickUrl(fallback) ?? DEFAULT_REGISTRY
  return url.replace(/\/+$/u, '')
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
    const url = `${registryFor(name)}/${encodeName(name)}/${version}`
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      counter.failed++
      return null
    }
    const data = (await res.json()) as RegistryManifest
    const manifest = {
      engines: data.engines,
      peerDependencies: data.peerDependencies
    }
    setVersionData(cacheKey, manifest)
    return manifest
  } catch {
    counter.failed++
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
    const url = `${registryFor(name)}/${encodeName(name)}/latest`
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) {
      counter.failed++
      return null
    }
    const data = (await res.json()) as RegistryManifest & { version: string }
    if (!data.version) {
      counter.failed++
      return null
    }
    const entry = {
      version: data.version,
      engines: data.engines,
      peerDependencies: data.peerDependencies
    }
    setLatestData(name, entry)
    return entry
  } catch {
    counter.failed++
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
 * @returns {Promise<ResolveResult>} Enriched packages plus the count of failed lookups.
 */
export async function resolveRegistry(
  packages: Package[],
  options: ResolveOptions
): Promise<ResolveResult> {
  if (options.offline) {
    const resolved = packages.map(pkg => {
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
    return { packages: resolved, failed: 0 }
  }

  const result: Package[] = []
  let completedCount = 0
  const cacheCounter: CacheCounter = { cached: 0, failed: 0 }
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY)
    const resolved = await processBatch(batch, cacheCounter)
    result.push(...resolved)
    completedCount += batch.length
    options.onProgress?.(completedCount, packages.length, cacheCounter.cached)
  }
  return { packages: result, failed: cacheCounter.failed }
}
