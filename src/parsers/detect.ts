import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DetectedLockfile } from '../types.js'

/**
 * Checks if a yarn.lock file is a Yarn Berry (v2+) lockfile.
 * @param {string} lockfilePath Path to the yarn.lock file.
 * @returns {boolean} True if the lockfile is Yarn Berry format.
 */
function isYarnBerry(lockfilePath: string): boolean {
  try {
    const head = readFileSync(lockfilePath, { encoding: 'utf8' })
    return head.slice(0, 512).includes('__metadata:')
  } catch {
    return false
  }
}

/**
 * Detects the lockfile type in a directory.
 * @param {string} dir The directory to search for a lockfile.
 * @returns {DetectedLockfile | null} Detected lockfile info or null if not found.
 */
export function detectLockfile(dir: string): DetectedLockfile | null {
  const npmPath = join(dir, 'package-lock.json')
  if (existsSync(npmPath) === true) {
    return { path: npmPath, type: 'npm', manager: 'npm' }
  }

  const pnpmPath = join(dir, 'pnpm-lock.yaml')
  if (existsSync(pnpmPath) === true) {
    return { path: pnpmPath, type: 'pnpm', manager: 'pnpm' }
  }

  const yarnPath = join(dir, 'yarn.lock')
  if (existsSync(yarnPath) === true) {
    const berry = isYarnBerry(yarnPath)
    return {
      path: yarnPath,
      type: berry ? 'yarn-berry' : 'yarn-classic',
      manager: 'yarn'
    }
  }

  return null
}
