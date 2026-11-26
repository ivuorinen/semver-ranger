import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

const TTL_24H = 24 * 60 * 60 * 1000
// Roughly 5 MB on disk. Version manifests are immutable, so nothing else evicts them.
const MAX_VERSION_ENTRIES = 50_000

/**
 * Narrows a parsed JSON value to an object with string keys.
 * @param {unknown} value The value to check.
 * @returns {boolean} True for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns an environment directory when it is usable.
 *
 * The XDG specification treats empty and relative values as unset. Accepting
 * them wrote the cache into whatever directory the tool was run from.
 * @param {string | undefined} value Raw environment value.
 * @returns {string | null} The absolute directory, or null.
 */
function absoluteDir(value: string | undefined): string | null {
  return typeof value === 'string' && isAbsolute(value) ? value : null
}

/**
 * Returns the directory path used for caching semver-ranger data.
 * @returns {string} Absolute path to the cache directory.
 */
export function getCacheDir(): string {
  const xdg = absoluteDir(process.env.XDG_CACHE_HOME)
  if (xdg !== null) return join(xdg, 'semver-ranger')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'semver-ranger')
  if (process.platform === 'win32') {
    const localAppData =
      absoluteDir(process.env.LOCALAPPDATA) ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'semver-ranger', 'Cache')
  }
  return join(homedir(), '.cache', 'semver-ranger')
}

interface CachedManifest {
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface LatestEntry {
  data: CachedManifest & { version: string }
  cachedAt: number
}

interface Store<T> {
  file: string
  entries: Map<string, T>
  dirty: boolean
}

let versionsStore: Store<CachedManifest> | null = null
let latestStore: Store<LatestEntry> | null = null

/**
 * Loads a store from its JSON file. A missing or corrupt file yields an empty
 * store: the cache is only a speed optimisation, so it must never fail a run.
 * @param {string} name Store name, used as the file's base name.
 * @returns {Store<T>} The loaded store.
 */
function openStore<T>(name: string): Store<T> {
  const file = join(getCacheDir(), `${name}.json`)
  let entries = new Map<string, T>()
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (isRecord(parsed)) entries = new Map(Object.entries(parsed) as [string, T][])
  } catch {
    // Start empty; flushCache rewrites the file.
  }
  return { file, entries, dirty: false }
}

/**
 * Records a value in a store; it reaches disk on the next flushCache().
 * @param {Store<T>} store The store to update.
 * @param {string} key The entry key.
 * @param {T} value The entry value.
 * @returns {void}
 */
function setEntry<T>(store: Store<T>, key: string, value: T): void {
  store.entries.set(key, value)
  store.dirty = true
}

/**
 * Returns the singleton store for immutable version manifests.
 * @returns {Store<CachedManifest>} The versions cache store.
 */
function versionsCache(): Store<CachedManifest> {
  versionsStore ??= openStore('versions')
  return versionsStore
}

/**
 * Returns the singleton store for latest-version data.
 * @returns {Store<LatestEntry>} The latest-version cache store.
 */
function latestCache(): Store<LatestEntry> {
  latestStore ??= openStore('latest')
  return latestStore
}

/**
 * Tells whether a manifest field has the shape the analysis reads: absent, or
 * an object of constraints.
 *
 * Only the shape is checked. The analysis shows a non-string value as
 * unparseable; rejecting the whole object for one, as a value check did,
 * discarded its valid siblings, so every warm run reported a wider range than
 * the run that fetched the manifest.
 * @param {unknown} value The field's value.
 * @returns {boolean} True when absent, or a non-null, non-array object.
 */
function isConstraintMap(value: unknown): value is Record<string, string> | undefined {
  return typeof value === 'undefined' || isRecord(value)
}

/**
 * Keeps the constraint fields a store can serve back unchanged.
 *
 * Old releases on the registry declare `engines` as a string or an array, which
 * the analysis ignores. Stored as-is, the entry failed the read check on every
 * later run, so it was refetched online and called unresolved offline.
 * @param {CachedManifest} data A registry manifest's constraint fields.
 * @returns {CachedManifest} The fields that are objects; others are left out.
 */
function constraintFields(data: CachedManifest): CachedManifest {
  return {
    ...(isRecord(data.engines) && { engines: data.engines }),
    ...(isRecord(data.peerDependencies) && { peerDependencies: data.peerDependencies })
  }
}

/**
 * Retrieves cached manifest data for a specific package version.
 *
 * Entries come from a file on disk and setVersionData writes only well-formed
 * ones, so anything else is corruption. Serving it counted the package as
 * resolved: online it was never refetched, offline its "no metadata" warning
 * was skipped, and its constraints silently dropped out of the range.
 * @param {string} key Cache key in the format "name@version".
 * @returns {CachedManifest | null} Cached manifest, or null if missing or malformed.
 */
export function getVersionData(key: string): CachedManifest | null {
  const entry: unknown = versionsCache().entries.get(key)
  if (
    !isRecord(entry) ||
    !isConstraintMap(entry.engines) ||
    !isConstraintMap(entry.peerDependencies)
  ) {
    return null
  }
  return entry as CachedManifest
}

/**
 * Stores manifest data for a specific package version in the cache.
 *
 * Returns what was stored so the fetching run analyses exactly what later runs
 * read back; returning the raw manifest let the two disagree.
 * @param {string} key Cache key in the format "name@version".
 * @param {CachedManifest} data The manifest data to cache.
 * @returns {CachedManifest} The stored entry.
 */
export function setVersionData(key: string, data: CachedManifest): CachedManifest {
  const entry = constraintFields(data)
  setEntry(versionsCache(), key, entry)
  return entry
}

/**
 * Checks that a stored entry is well formed and unexpired.
 *
 * Entries arrive from a file on disk, so the shape cannot be assumed: a stray
 * `null` crashed the run, a missing timestamp compared as never expired, and a
 * string where an object belongs was served as constraints.
 * @param {LatestEntry | undefined} entry The stored entry.
 * @param {number} now Current timestamp in milliseconds.
 * @returns {boolean} True when the entry can be used.
 */
function isFresh(entry: LatestEntry | undefined, now: number): entry is LatestEntry {
  return (
    typeof entry?.cachedAt === 'number' &&
    typeof entry.data?.version === 'string' &&
    isConstraintMap(entry.data.engines) &&
    isConstraintMap(entry.data.peerDependencies) &&
    now - entry.cachedAt <= TTL_24H
  )
}

/**
 * Retrieves cached latest-version manifest data if the entry has not expired.
 *
 * Reads the clock itself: a `now` parameter that no caller passed only gave
 * tests a second way to fake time beside mock timers.
 * @param {string} name Package name.
 * @returns {(CachedManifest & { version: string }) | null} Cached entry, or null if stale/missing.
 */
export function getLatestData(name: string): (CachedManifest & { version: string }) | null {
  const entry = latestCache().entries.get(name)
  return isFresh(entry, Date.now()) ? entry.data : null
}

/**
 * Stores latest-version manifest data in the cache, timestamped now.
 *
 * The timestamp is not a parameter: only tests passed one, and a caller could
 * otherwise backdate or future-date an entry past the 24-hour expiry. Like
 * setVersionData, it returns what was stored.
 * @param {string} name Package name.
 * @param {CachedManifest & { version: string }} data Latest manifest data to cache.
 * @returns {CachedManifest & { version: string }} The stored data.
 */
export function setLatestData(
  name: string,
  data: CachedManifest & { version: string }
): CachedManifest & { version: string } {
  const stored = { version: data.version, ...constraintFields(data) }
  setEntry(latestCache(), name, { data: stored, cachedAt: Date.now() })
  return stored
}

/**
 * Drops entries that can never be served again from stores about to be written.
 *
 * Both files are read and rewritten whole on every run, so anything kept here
 * costs time forever. Map order is insertion order, so the oldest versions go first.
 * @returns {void}
 */
function pruneStores(): void {
  if (latestStore?.dirty === true) {
    const now = Date.now()
    for (const [name, entry] of latestStore.entries) {
      if (!isFresh(entry, now)) latestStore.entries.delete(name)
    }
  }
  if (versionsStore?.dirty === true) {
    let excess = versionsStore.entries.size - MAX_VERSION_ENTRIES
    for (const key of versionsStore.entries.keys()) {
      if (excess <= 0) break
      versionsStore.entries.delete(key)
      excess -= 1
    }
  }
}

/**
 * Writes both cache stores to disk.
 *
 * Each write serializes the entire store, so writing per key would cost O(n^2)
 * bytes across a run. Callers mutate freely and flush once at the end instead.
 *
 * Persistence is best-effort and never throws: the cache is a speed
 * optimisation, so a failed write must not turn a successful run into a
 * failure, nor replace an error already being reported. Each store is
 * attempted independently so one failure does not skip the other.
 *
 * The rename makes the replacement atomic, so a concurrent reader or a killed
 * process never sees half a file. Concurrent runs still overwrite each other;
 * losing cached entries costs only a refetch. A failed write or rename removes
 * its temporary file: the name carries the pid, so each failing run left
 * another copy of the store, up to about 5 MB, in the cache directory.
 * @returns {Error | null} The first write failure, or null if both succeeded.
 */
export function flushCache(): Error | null {
  pruneStores()
  let failure: Error | null = null
  for (const store of [versionsStore, latestStore]) {
    if (store?.dirty !== true) continue
    const temporary = `${store.file}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(store.file), { recursive: true })
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(store.entries)))
      renameSync(temporary, store.file)
      store.dirty = false
    } catch (err: unknown) {
      failure ??= err as Error
      try {
        // Not recursive: a directory at this path was not created here.
        rmSync(temporary, { force: true })
      } catch {
        // Still never throws; the write failure is the one worth reporting.
      }
    }
  }
  return failure
}
