import { join } from 'node:path'
import flatCache from 'flat-cache'
import envPaths from 'env-paths'

const TTL_24H = 24 * 60 * 60 * 1000

/**
 * Returns the directory path used for caching semver-ranger data.
 * @returns {string} Absolute path to the cache directory.
 */
export function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return join(xdg, 'semver-ranger')
  try {
    return envPaths('semver-ranger', { suffix: '' }).cache
    /* c8 ignore start */
  } catch {
    // fallback — envPaths only throws if platform paths are unavailable
  }
  return join(process.env.HOME ?? '.', '.cache', 'semver-ranger')
  /* c8 ignore stop */
}

interface CachedManifest {
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface LatestEntry {
  data: CachedManifest & { version: string }
  cachedAt: number
}

type FlatCacheInstance = ReturnType<typeof flatCache.create>

let versionsStore: FlatCacheInstance | null = null
let latestStore: FlatCacheInstance | null = null

/**
 * Returns the singleton flat-cache instance for immutable version manifests.
 * @returns {FlatCacheInstance} The versions cache store.
 */
function versionsCache(): FlatCacheInstance {
  if (!versionsStore) {
    versionsStore = flatCache.create({ cacheId: 'versions', cacheDir: getCacheDir() })
  }
  return versionsStore
}

/**
 * Returns the singleton flat-cache instance for latest-version data.
 * @returns {FlatCacheInstance} The latest-version cache store.
 */
function latestCache(): FlatCacheInstance {
  if (!latestStore) {
    latestStore = flatCache.create({ cacheId: 'latest', cacheDir: getCacheDir() })
  }
  return latestStore
}

/**
 * Retrieves cached manifest data for a specific package version.
 * @param {string} key Cache key in the format "name@version".
 * @returns {CachedManifest | null} Cached manifest or null if not found.
 */
export function getVersionData(key: string): CachedManifest | null {
  return (versionsCache().getKey(key) as CachedManifest | undefined) ?? null
}

/**
 * Stores manifest data for a specific package version in the cache.
 * @param {string} key Cache key in the format "name@version".
 * @param {CachedManifest} data The manifest data to cache.
 * @returns {void}
 */
export function setVersionData(key: string, data: CachedManifest): void {
  versionsCache().setKey(key, data)
  versionsCache().save()
}

/**
 * Retrieves cached latest-version manifest data if the entry has not expired.
 * @param {string} name Package name.
 * @param {number} now Current timestamp in milliseconds (defaults to Date.now()).
 * @returns {(CachedManifest & { version: string }) | null} Cached entry, or null if stale/missing.
 */
export function getLatestData(
  name: string,
  now = Date.now()
): (CachedManifest & { version: string }) | null {
  const entry = latestCache().getKey(name) as LatestEntry | undefined
  if (!entry) return null
  if (now - entry.cachedAt > TTL_24H) return null
  return entry.data
}

/**
 * Stores latest-version manifest data in the cache with a timestamp.
 * @param {string} name Package name.
 * @param {CachedManifest & { version: string }} data Latest manifest data to cache.
 * @param {number} cachedAt Timestamp when cached (defaults to Date.now()).
 * @returns {void}
 */
export function setLatestData(
  name: string,
  data: CachedManifest & { version: string },
  cachedAt = Date.now()
): void {
  const entry: LatestEntry = { data, cachedAt }
  latestCache().setKey(name, entry)
  latestCache().save()
}
