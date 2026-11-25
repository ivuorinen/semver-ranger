import { globSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Package, PackageDeps } from '../types.ts'
import { readProjectManifest } from './detect.ts'
import { reach, type InstallSets, type LockNode } from './reach.ts'

const SPECIFIER = /"([^"]+)"|([^\s,"]+)/gu
const PACKAGE_NAME = /^(@[^/]+\/[^@]+|[^@]+)@/u
// "alias@npm:real@^1". A plain "pkg@npm:^1" has no second @ and does not match.
const NPM_ALIAS = /^(?:@[^/]+\/[^@]+|[^@]+)@npm:(@[^/]+\/[^@]+|[^@]+)@/u
// A git, file or tarball source: "github:me/foo", "me/foo", "file:./foo".
const NON_REGISTRY_RANGE = /^(?!npm:).*[:/]/u
// Exactly two spaces: a dependency named "version" sits at four, inside `dependencies:`.
const VERSION = /^ {2}version "?([^"\s]+)"?$/u
// Yarn quotes scoped names and most ranges, so closing quotes have to be allowed.
const DEPENDENCY = /^ {4}"?([^"\s]+)"? "?([^"]*)"?$/u

interface HeaderName {
  specifier: string
  installed: string
  real: string
  unpublished: boolean
}

/**
 * Splits lockfile content into lines, tolerating a BOM and CRLF line endings.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {string[]} The lines of the file.
 */
function lockLines(content: string): string[] {
  return content.replace(/^\ufeff/u, '').split(/\r?\n/u)
}

/**
 * Extracts the package names from an entry header such as `foo@^1, "@a/b@^2":`.
 * @param {string} header The entry header line, including its trailing colon.
 * @returns {HeaderName[]} One item per specifier; a merged header can hold aliases.
 */
function parseHeaderNames(header: string): HeaderName[] {
  return [...header.slice(0, -1).matchAll(SPECIFIER)].flatMap(([, quoted, bare]) => {
    const specifier = (quoted ?? bare) as string
    const installed = PACKAGE_NAME.exec(specifier)?.[1]
    if (typeof installed === 'undefined') return []
    return [
      {
        specifier,
        installed,
        real: NPM_ALIAS.exec(specifier)?.[1] ?? installed,
        unpublished: NON_REGISTRY_RANGE.test(specifier.slice(installed.length + 1))
      }
    ]
  })
}

/**
 * Parses a Yarn Classic (v1) lockfile and returns a list of packages.
 *
 * An alias specifier names the real package after `npm:`, and that is the name
 * the registry knows; analysing the alias looked up a package that does not
 * exist, or an unrelated one that does.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Package[]} Array of parsed packages with name and version.
 * @throws {Error} If a line is neither an entry header, an entry field nor a comment.
 */
export function parseYarnClassicLockfile(content: string): Package[] {
  const seen = new Set<string>()
  const result: Package[] = []
  let names: HeaderName[] = []

  for (const [index, line] of lockLines(content).entries()) {
    if (line === '' || line.startsWith('#')) continue

    if (!line.startsWith(' ')) {
      // Unindented means a new entry. Anything else here, such as a merge conflict
      // marker, would otherwise silently drop packages from the analysis.
      if (!line.endsWith(':')) {
        throw new Error(`Failed to parse yarn classic lockfile: invalid line ${index + 1}`)
      }
      names = parseHeaderNames(line)
      continue
    }

    const version = VERSION.exec(line)?.[1]
    if (typeof version === 'undefined') continue
    for (const { installed, real, unpublished } of names) {
      const dedupKey = `${real}@${version}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      const aliased = !names.some(other => other.installed === real)
      result.push({
        name: real,
        version,
        ...(aliased && { alias: installed }),
        ...(unpublished && { unpublished })
      })
    }
  }

  return result
}

/**
 * Indexes a lockfile's entries by every specifier that resolves to them.
 *
 * Only `dependencies:` and `optionalDependencies:` hold lines indented by four,
 * and yarn installs both in production.
 * @param {string} content The raw string content of the yarn.lock file.
 * @returns {Map<string, LockNode>} Nodes by `name@range` specifier.
 */
function classicNodes(content: string): Map<string, LockNode> {
  const nodes = new Map<string, LockNode>()
  let node: LockNode = { id: '', deps: [] }

  for (const line of lockLines(content)) {
    if (!line.startsWith(' ')) {
      const names = parseHeaderNames(line)
      node = { id: names[0]?.real ?? '', deps: [] }
      for (const { specifier } of names) nodes.set(specifier, node)
      continue
    }
    const version = VERSION.exec(line)?.[1]
    if (typeof version !== 'undefined') node.id += `@${version}`
    const [, dep = '', range = ''] = DEPENDENCY.exec(line) ?? []
    if (dep !== '') node.deps.push(`${dep}@${range}`)
  }

  return nodes
}

/**
 * Reads the root manifest and those of its workspace members.
 *
 * yarn.lock does not record workspaces at all, so their dependencies can only be
 * found on disk.
 *
 * An unusable member manifest fails the run, as the root's does in the CLI. It
 * used to be skipped without a word: its production dependencies stopped being
 * roots, so what only they need looked dev-only and `--no-dev` removed it.
 *
 * The workspaces field is checked rather than trusted: package.json is cast to
 * its type unchecked, so `"workspaces": { "packages": "packages/*" }` reached
 * `.flatMap` as a string and crashed with a stack trace, and a string
 * `workspaces` was read as no workspaces at all.
 * @param {string} projectDir Directory holding the root package.json.
 * @returns {PackageDeps[]} The root manifest and every member's.
 * @throws {Error} If the workspaces field is not a list of patterns, or a member's
 * package.json cannot be read or parsed, or is null.
 */
function projectManifests(projectDir: string): PackageDeps[] {
  const root = readProjectManifest(projectDir).deps ?? {}
  const workspaces: unknown = root.workspaces
  const inObject =
    typeof workspaces === 'object' && workspaces !== null && !Array.isArray(workspaces)
  const patterns: unknown = inObject
    ? ((workspaces as { packages?: unknown }).packages ?? [])
    : (workspaces ?? [])
  if (!Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === 'string')) {
    throw new Error(
      `--no-dev cannot read the workspaces field of ${join(projectDir, 'package.json')}`
    )
  }
  const members = patterns.flatMap(pattern =>
    globSync(`${pattern}/package.json`, {
      cwd: projectDir,
      exclude: name => name === 'node_modules'
    })
  )
  const manifests = members.map(file => {
    const memberDir = join(projectDir, dirname(file))
    const { deps, error } = readProjectManifest(memberDir)
    if (deps === null) {
      const reason = error === null ? '' : `: ${error}`
      throw new Error(`--no-dev needs a readable package.json in ${memberDir}${reason}`)
    }
    return deps
  })
  return [root, ...manifests]
}

/**
 * Lists a dependency block as lockfile specifiers.
 * @param {Record<string, string> | undefined} deps The dependency block.
 * @returns {string[]} One `name@range` per dependency.
 */
function specifiers(deps: Record<string, string> | undefined): string[] {
  return Object.entries(deps ?? {}).map(([name, range]) => `${name}@${range}`)
}

/**
 * Walks a Yarn Classic lockfile from the root and every workspace member, as
 * `yarn install --production` does.
 *
 * Yarn also installs a dev dependency that a production package names as a peer.
 * Peers are not in yarn.lock, so this sees only those of installed packages.
 * @param {string} content The raw string content of the yarn.lock file.
 * @param {string} projectDir Directory holding the root package.json.
 * @param {Package[]} packages Packages with whatever peers are known so far.
 * @returns {InstallSets} What production and dev installs bring in.
 * @throws {Error} If a workspace member's package.json is unusable; skipping it
 * would remove what only that member needs.
 */
export function yarnClassicInstallSets(
  content: string,
  projectDir: string,
  packages: Package[]
): InstallSets {
  const nodes = classicNodes(content)
  const manifests = projectManifests(projectDir)
  const productionRoots = manifests.flatMap(manifest =>
    specifiers({ ...manifest.optionalDependencies, ...manifest.dependencies })
  )
  const devRoots = manifests.flatMap(manifest => specifiers(manifest.devDependencies))

  const peers = new Map(packages.map(pkg => [`${pkg.name}@${pkg.version}`, pkg.peerDependencies]))
  for (const node of nodes.values()) {
    for (const peer of Object.keys(peers.get(node.id) ?? {})) {
      node.deps.push(...devRoots.filter(root => root.startsWith(`${peer}@`)))
    }
  }

  return { production: reach(productionRoots, nodes), dev: reach(devRoots, nodes) }
}
