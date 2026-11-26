import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DetectedLockfile, PackageDeps } from '../types.ts'

const HEADER_LENGTH = 512

interface ProjectManifest {
  deps: PackageDeps | null
  /** Why an existing package.json could not be used */
  error: string | null
}

/**
 * Reads the project's package.json once, for every stage that needs it.
 *
 * A missing file is ordinary, since a lockfile can be analysed on its own. An
 * unusable one is reported, because ignoring it silently switched off --no-dev
 * and peer detection.
 * @param {string} projectDir Directory containing package.json.
 * @returns {ProjectManifest} The parsed manifest, or why it could not be read.
 */
export function readProjectManifest(projectDir: string): ProjectManifest {
  try {
    const raw = readFileSync(join(projectDir, 'package.json'), 'utf8')
    return { deps: JSON.parse(raw) as PackageDeps, error: null }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { deps: null, error: null }
    return { deps: null, error: (err as Error).message }
  }
}

/**
 * Checks if a yarn.lock file is a Yarn Berry (v2+) lockfile.
 * Only the header counts: the marker can appear later in a classic lockfile.
 * @param {string} lockfilePath Path to the yarn.lock file.
 * @returns {boolean} True if the lockfile is Yarn Berry format.
 */
export function isYarnBerry(lockfilePath: string): boolean {
  try {
    return readFileSync(lockfilePath, 'utf8').slice(0, HEADER_LENGTH).includes('__metadata:')
  } catch {
    return false
  }
}

// npm reads npm-shrinkwrap.json and ignores package-lock.json when both exist.
const LOCKFILE_NAMES = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']

/**
 * Tells a lockfile's format from its file name.
 *
 * Auto-detection and an explicit path both map names here: written twice, the
 * mappings could disagree, as when npm-shrinkwrap.json was accepted by neither.
 * @param {string} path Path to the lockfile.
 * @returns {DetectedLockfile | null} The lockfile info, or null for an unknown name.
 */
export function lockfileAt(path: string): DetectedLockfile | null {
  switch (basename(path)) {
    case 'npm-shrinkwrap.json':
    case 'package-lock.json':
      return { path, type: 'npm', manager: 'npm' }
    case 'pnpm-lock.yaml':
      return { path, type: 'pnpm', manager: 'pnpm' }
    case 'yarn.lock':
      return { path, type: isYarnBerry(path) ? 'yarn-berry' : 'yarn-classic', manager: 'yarn' }
    default:
      return null
  }
}

/**
 * Detects the lockfile type in a directory.
 * Tries names in npm's order of precedence: a project locked with a shrinkwrap
 * was reported as having no lockfile, or analysed from the package-lock.json
 * that npm ignores.
 * @param {string} dir The directory to search for a lockfile.
 * @returns {DetectedLockfile | null} Detected lockfile info or null if not found.
 */
export function detectLockfile(dir: string): DetectedLockfile | null {
  const name = LOCKFILE_NAMES.find(file => existsSync(join(dir, file)))
  return typeof name === 'undefined' ? null : lockfileAt(join(dir, name))
}
