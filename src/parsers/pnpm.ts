import { parseAllDocuments } from 'yaml'
import type { Package, NameVersion } from '../types.ts'
import { reach, type InstallSets, type LockNode } from './reach.ts'

// v6: "/pkg@1.0.0" or "/@scope/pkg@1.0.0"
const V6_KEY = /^\/(@[^/]+\/[^@]+|[^@/][^@]*)@(.+)$/u
// v9: "pkg@1.0.0" or "@scope/pkg@1.0.0"
const V9_KEY = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/u
const MIN_LOCKFILE_VERSION = 6
// A package outside a registry has its source where the version would be.
const REGISTRY_VERSION = /^\d/u

/** Maps a dependency to its reference, directly or under `version` in an importer */
type PnpmDependencies = Record<string, unknown>

interface PnpmDependencyBlocks {
  dependencies?: PnpmDependencies
  optionalDependencies?: PnpmDependencies
  devDependencies?: PnpmDependencies
}

interface PnpmPackageEntry extends PnpmDependencyBlocks {
  /** Written in v6 for a package keyed by its source rather than `name@version` */
  name?: string
  version?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface LockPackage extends NameVersion {
  /** The entry from the `packages` block, which holds engines and peers */
  meta: PnpmPackageEntry
  /** Installed from a git, tarball or directory source rather than a registry */
  unpublished: boolean
}

interface PnpmLock extends PnpmDependencyBlocks {
  lockfileVersion?: string | number
  /** Absent from a v6 file outside a workspace, which has the root's blocks at the top */
  importers?: Record<string, PnpmDependencyBlocks>
  packages?: Record<string, PnpmPackageEntry | null>
  snapshots?: Record<string, PnpmPackageEntry | null>
}

let lastRead: { content: string; lock: PnpmLock } | undefined

/**
 * Parses and validates a pnpm lockfile.
 *
 * Keys in lockfile v5 (`/pkg/1.0.0`) match neither pattern below, so without
 * this check those packages disappeared or came back with garbled names while
 * the run still exited 0.
 *
 * pnpm 11 and later put an env document before the lockfile proper when the
 * project pins its package manager or has config dependencies. Reading the file
 * as one document failed with "Source contains multiple documents", so the last
 * document is used: the env one lists tooling, not the project's dependencies.
 *
 * yaml's duplicate-key check scans every earlier key of a mapping, which made
 * parsing quadratic in the package count; pnpm never writes a key twice, so the
 * check is off. The last result is kept because `--no-dev` reads the same content
 * a second time, and the two parses took about 17 s for 20,000 packages.
 * @param {string} content The raw YAML string content of the lockfile.
 * @returns {PnpmLock} The parsed lockfile; the same object for the same content.
 * @throws {Error} If the YAML is malformed, the root is not a mapping or the
 * lockfile version is unsupported.
 */
function readLock(content: string): PnpmLock {
  if (lastRead?.content === content) return lastRead.lock
  const documents = parseAllDocuments(content, { uniqueKeys: false })
  const [error] = documents.flatMap(document => document.errors)
  if (typeof error !== 'undefined') throw error
  const parsed: unknown = documents.at(-1)?.toJS()
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('unrecognised pnpm-lock.yaml: expected a mapping')
  }
  const lock = parsed as PnpmLock
  if (!(Number(lock.lockfileVersion) >= MIN_LOCKFILE_VERSION)) {
    // JSON.stringify keeps control characters in this file's content off the terminal.
    const found = JSON.stringify(lock.lockfileVersion)
    throw new Error(
      `unsupported pnpm-lock.yaml lockfileVersion: ${found} ` +
        `(expected ${MIN_LOCKFILE_VERSION} or later)`
    )
  }
  lastRead = { content, lock }
  return lock
}

/**
 * Removes the peer-resolution suffix from a key: `pkg@1.0.0(a@1(b@2))` -> `pkg@1.0.0`.
 *
 * Cuts at the first parenthesis because suffixes nest. Matching `(...)` pairs
 * stopped at the first `)`, leaving a stray `)` in the version and losing the
 * package's metadata.
 * @param {string} key The raw key from the lockfile.
 * @returns {string} The key without its suffix.
 */
function stripPeerSuffix(key: string): string {
  const suffix = key.indexOf('(')
  return (suffix === -1 ? key : key.slice(0, suffix)).trim()
}

/**
 * Reads which package a lockfile key installs, and that package's metadata.
 * Handles both v6 format (/pkg@1.0.0) and v9 format (pkg@1.0.0).
 *
 * v6 keys a git, tarball or directory package by its source (`file:../dep`,
 * `github.com/me/dep/abc123`) and writes its name and version into the entry.
 * Reading only the key dropped those packages and ended the `--no-dev` walk at
 * them. The entry's name wins over the key, because a source can hold an `@`
 * (`file:packages/@me/dep`) that the key patterns misread as a version.
 *
 * v9 keys such a package by name, with its source URL as the key's version and
 * the real one in the entry. The URL was shown as the version, and node_modules
 * could never match it. `unpublished` still follows the key: decided from the
 * entry's `7.0.0`, a git package would be looked up on the public registry.
 *
 * Both readers go through here, so the walk's `name@version` matches the list.
 * v9 snapshot keys carry a peer-resolution suffix while the packages block never
 * does; v6 suffixes the packages key itself, hence the fallback to the full key.
 * @param {string} key The raw key from the lockfile.
 * @param {PnpmLock['packages']} metaBlock The `packages` block.
 * @returns {LockPackage | null} The package, or null for a key naming none.
 */
function readPackage(key: string, metaBlock: PnpmLock['packages'] = {}): LockPackage | null {
  const stripped = stripPeerSuffix(key)
  const meta = metaBlock[stripped] ?? metaBlock[key] ?? {}
  if (typeof meta.name === 'string') {
    return { name: meta.name, version: meta.version ?? stripped, meta, unpublished: true }
  }
  const match = V6_KEY.exec(stripped) ?? V9_KEY.exec(stripped)
  if (match === null) return null
  const [, name = '', keyVersion = ''] = match
  const version = meta.version ?? keyVersion
  return { name, version, meta, unpublished: !REGISTRY_VERSION.test(keyVersion) }
}

/**
 * Parses a pnpm lockfile (v6 or v9) and returns a list of packages.
 * @param {string} content The raw YAML string content of the pnpm-lock.yaml file.
 * @returns {Package[]} Array of parsed packages with version and engine info.
 * @throws {Error} If the lockfile is malformed or older than version 6.
 */
export function parsePnpmLockfile(content: string): Package[] {
  const lock = readLock(content)

  const versionBlock = lock.snapshots ?? lock.packages ?? {}
  const result: Package[] = []
  const seen = new Set<string>()

  for (const key of Object.keys(versionBlock)) {
    const parsed = readPackage(key, lock.packages)
    if (parsed === null) continue
    const { name, version, meta, unpublished } = parsed

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    result.push({
      name,
      version,
      engines: meta.engines,
      peerDependencies: meta.peerDependencies,
      hasMetadata: true,
      ...(unpublished && { unpublished: true })
    })
  }

  return result
}

/**
 * Finds the lockfile keys a dependency block points at.
 *
 * A reference is usually the rest of a key (`dep: 1.0.0`), with a leading `/` in
 * v6, and for an alias it is the whole key (`nick: real@1.0.0`). Looking the
 * candidates up avoids parsing a reference that may be a URL holding its own `@`.
 * @param {PnpmDependencies | undefined} deps The dependency block.
 * @param {Record<string, unknown>} block The lockfile section holding the keys.
 * @returns {string[]} Keys of the dependencies the lockfile has; a workspace link has none.
 */
function nodeKeys(deps: PnpmDependencies | undefined, block: Record<string, unknown>): string[] {
  return Object.entries(deps ?? {}).flatMap(([dep, value]) => {
    const ref = (value as { version?: string } | null)?.version ?? String(value)
    return [`${dep}@${ref}`, `/${dep}@${ref}`, ref].find(key => Object.hasOwn(block, key)) ?? []
  })
}

/**
 * Walks a pnpm lockfile from every importer, as `pnpm install --prod` does.
 *
 * Exact keys tell peer-resolved variants and versions of one package apart, and
 * resolved peers are listed as ordinary dependencies. The importers name each
 * project's own dependency types, so package.json is not needed.
 * @param {string} content The raw YAML string content of the lockfile.
 * @returns {InstallSets} What production and dev installs bring in.
 * @throws {Error} If the lockfile is malformed or older than version 6.
 */
export function pnpmInstallSets(content: string): InstallSets {
  const lock = readLock(content)
  const block = lock.snapshots ?? lock.packages ?? {}
  const runtimeKeys = (owner: PnpmDependencyBlocks): string[] => [
    ...nodeKeys(owner.dependencies, block),
    ...nodeKeys(owner.optionalDependencies, block)
  ]

  const nodes = new Map<string, LockNode>()
  for (const [key, entry] of Object.entries(block)) {
    const parsed = readPackage(key, lock.packages)
    if (parsed === null) continue
    nodes.set(key, { id: `${parsed.name}@${parsed.version}`, deps: runtimeKeys(entry ?? {}) })
  }

  const importers = Object.values(lock.importers ?? { '.': lock })
  return {
    production: reach(importers.flatMap(runtimeKeys), nodes),
    dev: reach(
      importers.flatMap(importer => nodeKeys(importer.devDependencies, block)),
      nodes
    )
  }
}
