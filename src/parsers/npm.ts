import type { Package } from '../types.ts'
import type { InstallSets } from './reach.ts'

const NODE_MODULES = 'node_modules/'
// A v1 alias keeps its real package in the version field: "npm:string-width@4.2.3".
const V1_ALIAS = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/u
// A v1 entry outside a registry has its source in the version field instead of a version.
const REGISTRY_VERSION = /^\d/u
// A registry tarball is `<name>/-/<file>.tgz`, with the scope repeated before the
// file on GitLab. A GitLab archive also has `/-/`, but more segments after it.
// GitHub Packages is the one common registry with neither.
const REGISTRY_TARBALL =
  /^https?:\/\/(?:.*\/-\/(?:@[^/]+\/)?[^/]+\.tgz|npm\.pkg\.github\.com\/download\/)/u
// How npm names a folder with no recorded name: its last segment, plus any scope above it.
// The prefix ends at a `/`, so a scope is only ever a whole segment.
const FOLDER_NAME = /^(?:.*?\/)??((?:@[^/]+\/)?[^/]+)$/u

interface NpmLockV1Entry {
  version: string
  dev?: boolean
  dependencies?: Record<string, NpmLockV1Entry>
}

interface NpmLockV2Entry {
  version?: string
  name?: string
  resolved?: string
  dev?: boolean
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface NpmLock {
  lockfileVersion?: unknown
  packages?: Record<string, NpmLockV2Entry>
  dependencies?: Record<string, NpmLockV1Entry>
}

interface LockEntry {
  pkg: Package
  dev: boolean | undefined
}

/**
 * Reads the installed name from a v2/v3 `packages` key.
 * @param {string} key A key containing at least one `node_modules/` segment.
 * @returns {string} The last segment, which is the name the package is installed under.
 */
function installName(key: string): string {
  return key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length)
}

/**
 * Builds a Package from a v2/v3 entry.
 *
 * A key with no `node_modules/` segment is a workspace member, which would
 * otherwise be named after its directory and fail every registry lookup. npm
 * records an alias's real package in `name`, and that is the name the registry
 * knows; the installed name is kept for reading node_modules.
 * @param {string} key The entry's key in `packages`.
 * @param {NpmLockV2Entry} entry The lockfile entry.
 * @param {string} version The entry's version.
 * @returns {Package} The parsed package.
 */
function v2Package(key: string, entry: NpmLockV2Entry, version: string): Package {
  const metadata = {
    version,
    engines: entry.engines,
    peerDependencies: entry.peerDependencies,
    hasMetadata: true
  }
  if (!key.includes(NODE_MODULES)) {
    return { name: entry.name ?? key.replace(FOLDER_NAME, '$1'), unpublished: true, ...metadata }
  }
  const installed = installName(key)
  const name = entry.name ?? installed
  const fromRegistry =
    typeof entry.resolved === 'undefined' || REGISTRY_TARBALL.test(entry.resolved)
  return {
    name,
    ...(name !== installed && { alias: installed }),
    ...(!fromRegistry && { unpublished: true }),
    ...metadata
  }
}

/**
 * Builds a Package from a v1 entry.
 * @param {string} installed The name the package is installed under.
 * @param {NpmLockV1Entry} dep The lockfile entry.
 * @returns {Package} The parsed package.
 */
function v1Package(installed: string, dep: NpmLockV1Entry): Package {
  const [, name = installed, version = dep.version] = V1_ALIAS.exec(dep.version) ?? []
  return {
    name,
    version,
    ...(name !== installed && { alias: installed }),
    ...(!REGISTRY_VERSION.test(version) && { unpublished: true })
  }
}

/**
 * Lists a v1 tree, including versions nested under each entry.
 *
 * Only the top level used to be read, so every non-hoisted version, usually the
 * older and more restrictive one, was missing from the analysis.
 * @param {Record<string, NpmLockV1Entry> | undefined} deps One level of the tree.
 * @returns {LockEntry[]} Every entry at this level and below.
 */
function v1Entries(deps: Record<string, NpmLockV1Entry> | undefined): LockEntry[] {
  return Object.entries(deps ?? {}).flatMap(([installed, dep]) => [
    { pkg: v1Package(installed, dep), dev: dep.dev },
    ...v1Entries(dep.dependencies)
  ])
}

/**
 * Lists every installed entry of a lockfile, including repeated copies.
 * @param {NpmLock} lock The parsed lockfile.
 * @returns {LockEntry[]} The lockfile's entries.
 */
function lockEntries(lock: NpmLock): LockEntry[] {
  if (lock.lockfileVersion === 1) return v1Entries(lock.dependencies)
  return Object.entries(lock.packages ?? {}).flatMap(([key, entry]) =>
    key === '' || typeof entry.version === 'undefined'
      ? []
      : [{ pkg: v2Package(key, entry, entry.version), dev: entry.dev }]
  )
}

/**
 * Parses package-lock.json text and checks that its root is an object.
 *
 * A `null` root reached destructuring as a TypeError, which the CLI prints as a
 * programming error with a stack trace instead of naming the problem; the pnpm
 * and Yarn Berry parsers already refused a root that is not a mapping.
 * @param {string} content The raw JSON string content of the lockfile.
 * @returns {NpmLock} The parsed lockfile.
 * @throws {Error} If the content is not JSON or its root is not an object.
 */
function readLock(content: string): NpmLock {
  const lock: unknown = JSON.parse(content)
  if (typeof lock !== 'object' || lock === null || Array.isArray(lock)) {
    throw new Error('unrecognised package-lock.json: expected an object')
  }
  return lock as NpmLock
}

/**
 * Parses an npm package-lock.json file and returns a list of packages.
 * Supports lockfile versions 1, 2, and 3.
 *
 * The version is validated rather than inferred: a missing or non-numeric
 * `lockfileVersion` used to fall through to the v1 shape, which reads
 * `dependencies` and so returned an empty list for anything that was not a v1
 * lockfile — reporting a malformed file as one with no dependencies.
 *
 * Copies are merged by real `name@version`, as the other parsers do. Keyed on
 * the installed name, an alias and its real package were listed twice, which
 * doubled their rows and could blame the wrong package for a conflict.
 * @param {string} content The raw JSON string content of the lockfile.
 * @returns {Package[]} Array of parsed packages with version and engine info.
 * @throws {Error} If the root is not an object, or lockfileVersion is missing,
 * non-numeric, or unsupported.
 */
export function parseNpmLockfile(content: string): Package[] {
  const lock = readLock(content)
  const { lockfileVersion } = lock

  if (typeof lockfileVersion !== 'number' || !Number.isFinite(lockfileVersion)) {
    throw new Error('unrecognised package-lock.json: expected a numeric "lockfileVersion" field')
  }
  if (![1, 2, 3].includes(lockfileVersion)) {
    throw new Error(`unsupported package-lock.json lockfileVersion: ${String(lockfileVersion)}`)
  }

  const result: Package[] = []
  const seen = new Set<string>()
  for (const { pkg } of lockEntries(lock)) {
    const dedupKey = `${pkg.name}@${pkg.version}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    result.push(pkg)
  }
  return result
}

/**
 * Sorts a lockfile's packages by the `dev` flag npm writes on each entry.
 *
 * npm computes the flag from its full graph, covering optional dependencies,
 * workspaces, peers and nested copies, so there is nothing to work out here.
 * @param {string} content The raw JSON string content of the lockfile.
 * @returns {InstallSets} What production and dev installs bring in.
 * @throws {Error} If the content is not JSON or its root is not an object.
 */
export function npmInstallSets(content: string): InstallSets {
  const sets: InstallSets = { production: new Set(), dev: new Set() }
  for (const { pkg, dev } of lockEntries(readLock(content))) {
    const set = dev === true ? sets.dev : sets.production
    set.add(`${pkg.name}@${pkg.version}`)
  }
  return sets
}
