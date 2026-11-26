import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Package } from '../types.ts'
import { readProjectManifest } from './detect.ts'
import { reach, type InstallSets, type LockNode } from './reach.ts'

// Protocols are open-ended, and a range can have none at all ("foo@me/foo").
const DESCRIPTOR = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/u
const WORKSPACE_PROTOCOL = 'workspace:'
const PATCH_PROTOCOL = 'patch:'
// Yarn URL-encodes the source a patch wraps, so its `npm:` arrives as `npm%3A`.
const NPM_SOURCE = /^npm(?::|%3A)/iu

/**
 * Tells whether a resolved range comes from a registry.
 *
 * A patch wraps whatever it patches, after `patch:<name>@`: `npm%3A5.0.4` for a
 * registry package, `https%3A//github.com/...` for git, `file%3A...` for a local
 * path. Counting every patch as published sent a patched git or file package's
 * name to the registry, which could answer for an unrelated package.
 * @param {string} range The range from an entry's resolution.
 * @returns {boolean} True for an `npm:` range, or a patch of one.
 */
function fromRegistry(range: string): boolean {
  if (!range.startsWith(PATCH_PROTOCOL)) return NPM_SOURCE.test(range)
  // The name may be scoped, so its own leading `@` is skipped.
  return NPM_SOURCE.test(range.slice(range.indexOf('@', PATCH_PROTOCOL.length + 1) + 1))
}

interface YarnBerryEntry {
  version?: string
  resolution?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface Descriptor {
  name: string
  range: string
}

/** A dependency as its dependent lists it */
interface Dependency {
  name: string
  /** The key of the node it asks for, which the lockfile may not have */
  key: string
}

/**
 * Reads the entries of a Yarn Berry lockfile, which is plain YAML.
 *
 * The failsafe schema keeps every scalar a string: yarn writes `react: 18`
 * unquoted, and that is a semver range, not the number 18.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Record<string, YarnBerryEntry>} Lockfile entries by key; empty for an empty file.
 * @throws {Error} If the content is not valid YAML or its root is not a mapping.
 */
function parseBerryEntries(content: string): Record<string, YarnBerryEntry> {
  const parsed: unknown = parseYaml(content, { schema: 'failsafe', uniqueKeys: false }) ?? {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Failed to parse yarn berry lockfile: expected a mapping')
  }
  return parsed as Record<string, YarnBerryEntry>
}

/**
 * Parses one `name@range` descriptor.
 * @param {string} text The descriptor.
 * @returns {Descriptor[]} The descriptor, or nothing when the text is not one.
 */
function parseDescriptor(text: string): Descriptor[] {
  const [, name = '', range = ''] = DESCRIPTOR.exec(text) ?? []
  return name === '' ? [] : [{ name, range }]
}

/**
 * Splits an entry key into its descriptors.
 *
 * Yarn merges every range resolving to one package into a single key, aliases
 * included: `"alias@npm:real@^1, real@npm:^1"`.
 * @param {string} key The raw entry key.
 * @returns {Descriptor[]} One item per recognised descriptor.
 */
function parseDescriptors(key: string): Descriptor[] {
  return key.split(', ').flatMap(parseDescriptor)
}

/**
 * Reads where an entry actually came from.
 * @param {YarnBerryEntry} entry The lockfile entry.
 * @param {Descriptor} first The entry's first descriptor, used if it has no resolution.
 * @returns {Descriptor} The real package name and its source.
 */
function resolutionOf(entry: YarnBerryEntry, first: Descriptor): Descriptor {
  return parseDescriptor(entry.resolution ?? '')[0] ?? first
}

/**
 * Parses a Yarn Berry (v2+) lockfile and returns a list of packages.
 *
 * The real name comes from `resolution`, because the first descriptor in a key
 * may be an alias the registry does not know.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Package[]} Array of parsed packages with name and version.
 */
export function parseYarnBerryLockfile(content: string): Package[] {
  const parsed = parseBerryEntries(content)

  const seen = new Set<string>()
  const result: Package[] = []

  for (const [key, entry] of Object.entries(parsed)) {
    const descriptors = parseDescriptors(key)
    const [first] = descriptors
    if (typeof first === 'undefined' || first.range.startsWith(WORKSPACE_PROTOCOL)) continue
    const { name, range } = resolutionOf(entry, first)
    const version = entry.version
    if (typeof version === 'undefined' || version === '') continue

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    const aliased = !descriptors.some(descriptor => descriptor.name === name)
    // Berry lockfiles record peerDependencies but not engines; engines come
    // from the registry/local pass.
    result.push({
      name,
      version,
      peerDependencies: entry.peerDependencies,
      ...(aliased && { alias: first.name }),
      ...(!fromRegistry(range) && { unpublished: true })
    })
  }

  return result
}

/**
 * Builds the key a descriptor is looked up by.
 *
 * Keys always spell out `npm:`, but only Yarn 4 repeats it on a dependency's
 * range, so the protocol is dropped from both sides.
 * @param {Descriptor} descriptor The descriptor.
 * @returns {string} The lookup key.
 */
function nodeKey({ name, range }: Descriptor): string {
  return `${name}@${range.replace(/^npm:/u, '')}`
}

/**
 * Finds the nodes a dependency points at, falling back to every node of its name.
 *
 * The lockfile does not always hold the descriptor a dependency asks for. A root
 * `resolutions` entry pins it to another one, and a `file:` or `portal:` key ends
 * in the `::locator=` of the workspace declaring it. Each miss cut that package
 * and everything under it out of the production install. The fallback can add a
 * dev-only copy of the same name, which only narrows the reported range.
 * @param {ReadonlyMap<string, LockNode>} nodes Every node, by key.
 * @returns {(dep: Dependency) => string[]} Keys of the nodes a dependency reaches.
 */
function resolver(nodes: ReadonlyMap<string, LockNode>): (dep: Dependency) => string[] {
  // A key is `name@range`, and only a scoped name holds an `@`, as its first character.
  const byName = Map.groupBy(nodes.keys(), key => key.slice(0, key.indexOf('@', 1)))
  return ({ name, key }) => (nodes.has(key) ? [key] : (byName.get(name) ?? []))
}

/**
 * Walks a Yarn Berry lockfile from every workspace, as
 * `yarn workspaces focus --all --production` does.
 *
 * A workspace entry lists dev and production dependencies together, so only the
 * member's package.json can tell them apart. An unusable one fails the run, as
 * in Yarn Classic: treating every dependency as production quietly kept that
 * member's dev constraints in a `--no-dev` analysis, false conflicts included.
 * @param {string} content The raw string content of the yarn.lock file.
 * @param {string} projectDir Directory holding the root package.json.
 * @returns {InstallSets} What production and dev installs bring in.
 * @throws {Error} If a workspace member's package.json cannot be read or parsed.
 */
export function yarnBerryInstallSets(content: string, projectDir: string): InstallSets {
  const nodes = new Map<string, LockNode>()
  // Edges are resolved once every node exists, so that a miss can fall back by name.
  const edges = new Map<LockNode, Dependency[]>()
  const productionRoots: Dependency[] = []
  const devRoots: Dependency[] = []

  for (const [key, entry] of Object.entries(parseBerryEntries(content))) {
    const descriptors = parseDescriptors(key)
    const [first] = descriptors
    if (typeof first === 'undefined') continue
    const resolved = resolutionOf(entry, first)
    const deps = Object.entries(entry.dependencies ?? {}).map(([name, range]) => ({
      name,
      key: nodeKey({ name, range })
    }))

    if (first.range.startsWith(WORKSPACE_PROTOCOL)) {
      const memberDir = join(projectDir, resolved.range.slice(WORKSPACE_PROTOCOL.length))
      const { deps: manifest, error } = readProjectManifest(memberDir)
      if (manifest === null) {
        const reason = error === null ? '' : `: ${error}`
        throw new Error(`--no-dev needs a readable package.json in ${memberDir}${reason}`)
      }
      const runtime = { ...manifest.optionalDependencies, ...manifest.dependencies }
      const devOnly = new Set(
        Object.keys(manifest.devDependencies ?? {}).filter(name => !Object.hasOwn(runtime, name))
      )
      for (const dep of deps) {
        const roots = devOnly.has(dep.name) ? devRoots : productionRoots
        roots.push(dep)
      }
      continue
    }

    const node: LockNode = { id: `${resolved.name}@${String(entry.version)}`, deps: [] }
    edges.set(node, deps)
    for (const descriptor of descriptors) nodes.set(nodeKey(descriptor), node)
  }

  const resolve = resolver(nodes)
  for (const [node, deps] of edges) node.deps = deps.flatMap(resolve)
  return {
    production: reach(productionRoots.flatMap(resolve), nodes),
    dev: reach(devRoots.flatMap(resolve), nodes)
  }
}
