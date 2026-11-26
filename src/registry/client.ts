import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Package } from '../types.ts'
import {
  getVersionData,
  setVersionData,
  getLatestData,
  setLatestData,
  isRecord
} from '../cache/index.ts'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
// npm exports a non-default `registry` to the processes it starts, but never
// keys beginning with `@`, so per-scope settings have to be read from .npmrc.
const NPMRC_REGISTRY = /^\s*(@[^:\s]+:registry|registry)\s*=\s*["']?([^"'\s]+)/u
// CONCURRENCY is per-package; each package triggers 2 parallel fetches
// (fetchManifest + fetchLatest), so actual max requests = CONCURRENCY * 2.
// Set to 4 so we stay within ~8 total concurrent network requests.
const CONCURRENCY = 4
// Node's fetch has no default request timeout; without one a stalled socket
// hangs the whole run behind a spinner that never stops.
const REQUEST_TIMEOUT_MS = 10_000
// Two rounds of CONCURRENCY packages whose every request timed out: a registry
// that never answers costs 10 s per round.
const MAX_STALLED_PACKAGES = 2 * CONCURRENCY

type Registries = ReadonlyMap<string, string>

interface ResolveOptions {
  offline: boolean
  /**
   * Directory holding the project's .npmrc. Required: a caller that forgot it
   * would silently read the working directory's .npmrc instead.
   */
  projectDir: string
  /**
   * `cached` counts packages answered wholly from the cache. It counted lookups,
   * two per package, beside a package count, so a warm run showed `5/5 (10 cached)`.
   */
  onProgress?: (completed: number, total: number, cached: number) => void
}

type LatestManifest = RegistryManifest & { version: string }

/**
 * A lookup whose constraints are unknown. Structured so JSON readers need no
 * parser: the `name@version (reason)` strings it replaced had to be split on an
 * `@` that scoped names also contain.
 */
export interface Failure {
  name: string
  /** The installed version, or `latest` for the latest-release lookup */
  version: string
  reason: string
}

/**
 * The requests one package sent and how many timed out. Kept per package rather
 * than run-wide: lookups overlap, so a run-wide counter cannot say which
 * package's requests stalled.
 */
interface Tally {
  sent: number
  timedOut: number
}

interface LookupContext {
  registries: Registries
  /** Packages whose version and latest data both came from the cache */
  cached: number
  /** Requests that returned a non-ok status, timed out, or threw */
  failures: Failure[]
  /**
   * The /latest request for each cache key, kept for the run. Versions of one
   * package are looked up side by side before any has filled the cache, so each
   * requested /latest and a failure was reported once per version.
   */
  latestRequests: Map<string, Promise<LatestManifest | null>>
}

interface ResolveResult {
  packages: Package[]
  /** What failed and why */
  failures: Failure[]
  /** Packages not looked up because the registry stopped responding */
  skipped: Package[]
  /**
   * Registry packages with no cached latest data, offline only. The latest
   * ranges leave them out, which went unreported and looked complete. Listed
   * rather than counted, so a later filter can drop the ones it removes.
   */
  latestUncached: Package[]
}

/**
 * Reads an npm setting from the environment the way npm does: the variable name
 * in any case, empty values ignored, and the last match winning.
 * @param {string} key The setting's name in lower case.
 * @returns {string | undefined} The value, if one is set.
 */
function npmConfigEnv(key: string): string | undefined {
  return Object.entries(process.env).findLast(
    ([name, value]) => name.toLowerCase() === `npm_config_${key}` && value !== ''
  )?.[1]
}

/**
 * Reads registry settings from the user's and the project's .npmrc.
 *
 * Without this, private scopes were looked up on the default registry, which
 * disclosed internal package names to it.
 * @param {string} projectDir Directory holding the project's .npmrc.
 * @returns {Registries} Settings by key; a project file overrides the user's.
 * @throws {Error} When a .npmrc exists but cannot be read. Skipping it, as for a
 * missing file, sent private scoped names to the default registry unannounced.
 */
export function readRegistries(projectDir: string): Registries {
  const found = new Map<string, string>()
  const userConfig = npmConfigEnv('userconfig') ?? join(homedir(), '.npmrc')
  // ponytail: user and project .npmrc only, no global npmrc and no ${VAR}
  // expansion. Add them if a real configuration needs them.
  for (const file of [userConfig, join(projectDir, '.npmrc')]) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(`cannot read ${file}: ${(err as Error).message}`, { cause: err })
    }
    for (const line of text.split('\n')) {
      const [, key, url] = NPMRC_REGISTRY.exec(line) ?? []
      if (typeof key !== 'undefined' && typeof url !== 'undefined') found.set(key, url)
    }
  }
  return found
}

/**
 * Resolves the registry base URL for a package, honouring npm's precedence:
 * a per-scope setting, then the environment, then .npmrc, then the default.
 * @param {string} name The package name (possibly scoped).
 * @param {Registries} registries Settings from readRegistries. Required, as a
 * default of none would silently send private scopes to the default registry.
 * @returns {string} Registry base URL without a trailing slash.
 */
export function registryFor(name: string, registries: Registries): string {
  const scope = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : ''
  const url =
    registries.get(`${scope}:registry`) ??
    npmConfigEnv('registry') ??
    registries.get('registry') ??
    DEFAULT_REGISTRY
  return url.replace(/\/+$/u, '')
}

/**
 * Prefixes cache keys for anything other than the public registry.
 *
 * Two registries can publish different packages at the same coordinates, and
 * version entries never expire. The public registry stays unprefixed so
 * existing caches remain valid.
 * @param {string} name The package name.
 * @param {Registries} registries Settings from readRegistries.
 * @returns {string} The prefix for this package's cache keys.
 */
function cachePrefix(name: string, registries: Registries): string {
  const registry = registryFor(name, registries)
  return registry === DEFAULT_REGISTRY ? '' : `${registry}|`
}

interface RegistryManifest {
  version?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Encodes a package name for use in npm registry URLs.
 *
 * Names come from the lockfile, so everything is encoded; only the leading `@`
 * of a scope stays literal, as registries expect.
 * @param {string} name The package name (possibly scoped).
 * @returns {string} URL-encoded package name.
 */
function encodeName(name: string): string {
  return encodeURIComponent(name).replace(/^%40/u, '@')
}

/**
 * Names why a request threw. Every such failure used to read "network error",
 * which hid a proxy's HTML login page, a refused connection, an unknown host,
 * an intercepted certificate and a broken .npmrc URL behind one label.
 * @param {unknown} err What fetch or the JSON parse threw.
 * @returns {string} `timeout`, `malformed response`, or `network error: <code>`.
 */
function thrownReason(err: unknown): string {
  // fetch and res.json() reject only with Error subclasses, DOMException included.
  const { name, message, cause } = err as Error
  if (name === 'TimeoutError') return 'timeout'
  if (err instanceof SyntaxError) return 'malformed response'
  // fetch wraps the system error, so its own message is only "fetch failed".
  const { code } = (cause ?? {}) as { code?: unknown }
  return `network error: ${typeof code === 'string' ? code : message}`
}

/**
 * Requests one document from the registry, recording why it failed if it did.
 * Counts the request in the package's tally, so the stall breaker compares
 * timeouts with what that package actually sent rather than two per package.
 * @param {string} name The package name, used to pick the registry.
 * @param {string} tag The version or dist-tag to request.
 * @param {LookupContext} context Shared state for this run.
 * @param {Tally} tally The requesting package's counts.
 * @returns {Promise<RegistryManifest | null>} The document, or null on failure.
 */
async function fetchDocument(
  name: string,
  tag: string,
  context: LookupContext,
  tally: Tally
): Promise<RegistryManifest | null> {
  const fail = (reason: string): null => {
    context.failures.push({ name, version: tag, reason })
    return null
  }
  try {
    const registry = registryFor(name, context.registries)
    const url = `${registry}/${encodeName(name)}/${encodeURIComponent(tag)}`
    tally.sent++
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) return fail(`HTTP ${res.status}`)
    const data: unknown = await res.json()
    if (!isRecord(data)) return fail('malformed response')
    return data as RegistryManifest
  } catch (err: unknown) {
    const reason = thrownReason(err)
    if (reason === 'timeout') tally.timedOut++
    return fail(reason)
  }
}

/**
 * Fetches manifest data for a specific package version from the registry and
 * caches it. The caller has already found no cache entry.
 * @param {Package} pkg The package to look up.
 * @param {string} cacheKey Where the manifest is cached.
 * @param {LookupContext} context Shared state for this run.
 * @param {Tally} tally The package's request counts.
 * @returns {Promise<RegistryManifest | null>} Manifest data or null on failure.
 */
async function fetchManifest(
  pkg: Package,
  cacheKey: string,
  context: LookupContext,
  tally: Tally
): Promise<RegistryManifest | null> {
  const data = await fetchDocument(pkg.name, pkg.version, context, tally)
  if (data === null) return null
  return setVersionData(cacheKey, {
    engines: data.engines,
    peerDependencies: data.peerDependencies
  })
}

/**
 * Fetches the latest version manifest for a package from the registry and
 * caches it. Called through fetchLatestOnce.
 * @param {string} name The package name.
 * @param {string} cacheKey Where the latest manifest is cached.
 * @param {LookupContext} context Shared state for this run.
 * @param {Tally} tally The counts of the package that started the request.
 * @returns {Promise<LatestManifest | null>} Latest manifest or null.
 */
async function fetchLatest(
  name: string,
  cacheKey: string,
  context: LookupContext,
  tally: Tally
): Promise<LatestManifest | null> {
  const data = await fetchDocument(name, 'latest', context, tally)
  if (data === null) return null
  if (typeof data.version !== 'string' || data.version === '') {
    context.failures.push({ name, version: 'latest', reason: 'no version in response' })
    return null
  }
  return setLatestData(cacheKey, {
    version: data.version,
    engines: data.engines,
    peerDependencies: data.peerDependencies
  })
}

/**
 * Starts a package's /latest request, or joins the one already made this run.
 *
 * Versions of one name are looked up side by side before any has filled the
 * cache, so each sent its own request and reported its own copy of a failure.
 * A failed request is not retried for later versions either. A package that
 * joins sends nothing, so its tally stays as it was.
 * @param {string} name The package name.
 * @param {string} cacheKey Where the latest manifest is cached.
 * @param {LookupContext} context Shared state for this run.
 * @param {Tally} tally The calling package's request counts.
 * @returns {Promise<LatestManifest | null>} Latest manifest or null.
 */
async function fetchLatestOnce(
  name: string,
  cacheKey: string,
  context: LookupContext,
  tally: Tally
): Promise<LatestManifest | null> {
  let request = context.latestRequests.get(cacheKey)
  if (typeof request === 'undefined') {
    request = fetchLatest(name, cacheKey, context, tally)
    context.latestRequests.set(cacheKey, request)
  }
  return await request
}

/**
 * Tells whether a package has no registry release, recording it when nothing
 * vouches for its constraints.
 *
 * Both modes share it: offline once applied a public package's cache entries
 * to a workspace member of the same name and version.
 * @param {Package} pkg The package to check.
 * @param {Failure[]} failures Receives the package when its constraints are unknown.
 * @returns {boolean} True when the registry and its cache must be left alone.
 */
function isUnpublished(pkg: Package, failures: Failure[]): boolean {
  if (pkg.unpublished !== true) return false
  // With no registry to ask, an uninstalled package's constraints are unknown.
  if (pkg.hasMetadata !== true) {
    failures.push({ name: pkg.name, version: pkg.version, reason: 'not from a registry' })
  }
  return true
}

/**
 * Looks one package up in the cache and, for whatever is missing, the registry.
 *
 * A package counts as cached only when both its lookups are cache hits. Counting
 * each hit put up to twice the package count beside the progress figure.
 * @param {Package} pkg The package to look up.
 * @param {LookupContext} context Shared state for this run.
 * @returns {Promise<{resolved: Package, tally: Tally}>} The enriched package and
 * the requests it sent.
 */
async function processPackage(
  pkg: Package,
  context: LookupContext
): Promise<{ resolved: Package; tally: Tally }> {
  const tally: Tally = { sent: 0, timedOut: 0 }
  if (isUnpublished(pkg, context.failures)) return { resolved: pkg, tally }
  const latestKey = `${cachePrefix(pkg.name, context.registries)}${pkg.name}`
  const versionKey = `${latestKey}@${pkg.version}`
  const cachedCurrent = getVersionData(versionKey)
  const cachedLatest = getLatestData(latestKey)
  if (cachedCurrent !== null && cachedLatest !== null) context.cached++
  const [current, latest] = await Promise.all([
    cachedCurrent ?? fetchManifest(pkg, versionKey, context, tally),
    cachedLatest ?? fetchLatestOnce(pkg.name, latestKey, context, tally)
  ])
  const resolved = {
    ...pkg,
    engines: current?.engines ?? pkg.engines,
    peerDependencies: current?.peerDependencies ?? pkg.peerDependencies,
    ...(latest !== null && { latest })
  }
  return { resolved, tally }
}

/**
 * Resolves packages from the cache alone, reporting those nothing can vouch for.
 *
 * With no lockfile metadata, matching manifest or cache entry, a package's
 * constraints are unknown rather than absent, and dropping them widens the range.
 * Latest entries expire, so missing ones are counted for the same reason.
 * @param {Package[]} packages The packages to resolve.
 * @param {Registries} registries Settings from readRegistries.
 * @returns {ResolveResult} Enriched packages and the ones left unresolved.
 */
function resolveOffline(packages: Package[], registries: Registries): ResolveResult {
  const failures: Failure[] = []
  const latestUncached: Package[] = []
  const resolved = packages.map(pkg => {
    if (isUnpublished(pkg, failures)) return pkg
    const prefix = cachePrefix(pkg.name, registries)
    const manifest = getVersionData(`${prefix}${pkg.name}@${pkg.version}`)
    const latest = getLatestData(`${prefix}${pkg.name}`)
    if (manifest === null && pkg.hasMetadata !== true) {
      failures.push({ name: pkg.name, version: pkg.version, reason: 'no metadata' })
    }
    if (latest === null) latestUncached.push(pkg)
    return {
      ...pkg,
      ...(typeof manifest?.engines !== 'undefined' && { engines: manifest.engines }),
      ...(typeof manifest?.peerDependencies !== 'undefined' && {
        peerDependencies: manifest.peerDependencies
      }),
      ...(latest !== null && { latest })
    }
  })
  return { packages: resolved, failures, skipped: [], latestUncached }
}

/**
 * Resolves packages against the npm registry, with optional offline mode.
 *
 * CONCURRENCY workers each take the next package as soon as their last one is
 * done. Lockstep batches let one slow response idle every other slot: against a
 * registry where one request in ten took 600 ms, 200 cold packages took 15.6 s
 * in batches and 7.7 s with workers.
 * ponytail: a worker holds both of a package's lookups, so one slow /latest
 * still idles that worker; a pool of individual requests would reach about 5 s.
 *
 * Stops handing out packages after MAX_STALLED_PACKAGES in a row whose every
 * request timed out: a filtered network otherwise costs 10 s per round, over an
 * hour for a large lockfile. A package that sends nothing, cached or
 * unpublished, neither counts nor resets.
 * ponytail: packages already started when the breaker trips still run to their
 * timeout, up to CONCURRENCY - 1 of them: one extra 10 s round on a dead
 * registry. Cancel their requests with a shared AbortController if that matters.
 * @param {Package[]} packages The packages to resolve.
 * @param {ResolveOptions} options Resolution options including offline flag.
 * @returns {Promise<ResolveResult>} Enriched packages plus what could not be resolved.
 */
export async function resolveRegistry(
  packages: Package[],
  options: ResolveOptions
): Promise<ResolveResult> {
  const registries = readRegistries(options.projectDir)
  if (options.offline) return resolveOffline(packages, registries)

  const context: LookupContext = { registries, cached: 0, failures: [], latestRequests: new Map() }
  const result = [...packages]
  const queue = packages.entries()
  const lookedUp = new Set<number>()
  let completed = 0
  let stalled = 0
  let stop = false

  const worker = async (): Promise<void> => {
    for (const [index, pkg] of queue) {
      if (stop) return
      lookedUp.add(index)
      try {
        const { resolved, tally } = await processPackage(pkg, context)
        result[index] = resolved
        if (tally.sent > 0) stalled = tally.timedOut === tally.sent ? stalled + 1 : 0
        if (stalled >= MAX_STALLED_PACKAGES) stop = true
      } catch (err: unknown) {
        // A bug in one lookup must not leave the other workers fetching.
        stop = true
        throw err
      }
      completed++
      options.onProgress?.(completed, packages.length, context.cached)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const skipped = packages.filter((_, index) => !lookedUp.has(index))
  return { packages: result, failures: context.failures, skipped, latestUncached: [] }
}
