import { npmInstallSets } from '../parsers/npm.ts'
import { pnpmInstallSets } from '../parsers/pnpm.ts'
import type { InstallSets } from '../parsers/reach.ts'
import { yarnBerryInstallSets } from '../parsers/yarn-berry.ts'
import { yarnClassicInstallSets } from '../parsers/yarn-classic.ts'
import type { Package, LockfileType } from '../types.ts'

const INSTALL_SETS: Record<
  LockfileType,
  (content: string, projectDir: string, packages: Package[]) => InstallSets
> = {
  npm: npmInstallSets,
  pnpm: pnpmInstallSets,
  'yarn-classic': yarnClassicInstallSets,
  'yarn-berry': yarnBerryInstallSets
}

/**
 * Tells whether a format's dev filter must wait for registry data.
 *
 * Yarn Classic installs a dev dependency that a production package names as a
 * peer, but yarn.lock records no peers: filtered before the registry pass, such
 * a package was dropped whenever node_modules was absent. This lived in the CLI,
 * two layers from the format knowledge that makes it necessary.
 * @param {LockfileType} lockfileType The lockfile format.
 * @returns {boolean} True when filterDevPackages belongs after the registry pass.
 */
export function filtersAfterRegistry(lockfileType: LockfileType): boolean {
  return lockfileType === 'yarn-classic'
}

/**
 * Tells whether a format's dev filter reads package.json.
 *
 * npm records a `dev` flag per entry and pnpm records each importer's dependency
 * types, so only the Yarn formats need the manifest. Requiring it for every
 * format failed `--no-dev` on a lone npm or pnpm lockfile for no reason.
 * @param {LockfileType} lockfileType The lockfile format.
 * @returns {boolean} True when filtering without package.json would filter nothing.
 */
export function filterReadsManifest(lockfileType: LockfileType): boolean {
  return lockfileType === 'yarn-classic' || lockfileType === 'yarn-berry'
}

/**
 * Removes the packages this project's package manager would skip in a production
 * install. Each format decides that its own way, because they disagree.
 *
 * Only what a dev install is known to bring in is removed: dropping a package
 * nothing accounts for would silently widen the reported range.
 * @param {Package[]} packages All packages from the lockfile.
 * @param {string} projectDir Directory holding package.json and the lockfile.
 * @param {string} lockfileContent Raw lockfile content.
 * @param {LockfileType} lockfileType The lockfile format.
 * @returns {Package[]} The packages without the dev-only ones.
 * @throws {Error} If the lockfile is malformed, a Yarn workspace member's package.json
 * is unusable, or Yarn Classic's workspaces field is not a list of patterns: dropping
 * that member would hide its production dependencies.
 */
export function filterDevPackages(
  packages: Package[],
  projectDir: string,
  lockfileContent: string,
  lockfileType: LockfileType
): Package[] {
  const { production, dev } = INSTALL_SETS[lockfileType](lockfileContent, projectDir, packages)
  return packages.filter(pkg => {
    const id = `${pkg.name}@${pkg.version}`
    return production.has(id) || !dev.has(id)
  })
}
