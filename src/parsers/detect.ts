import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type { DetectedLockfile } from '../types.js'

const HEADER_BYTES = 512

/**
 * Checks if a yarn.lock file is a Yarn Berry (v2+) lockfile.
 * Reads only the file header rather than the whole lockfile.
 * @param {string} lockfilePath Path to the yarn.lock file.
 * @returns {boolean} True if the lockfile is Yarn Berry format.
 */
export function isYarnBerry(lockfilePath: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(lockfilePath, 'r')
    const buf = Buffer.alloc(HEADER_BYTES)
    const read = readSync(fd, buf, 0, HEADER_BYTES, 0)
    return buf.subarray(0, read).toString('utf8').includes('__metadata:')
    /* c8 ignore next 3 */
  } catch {
    return false
  } finally {
    if (typeof fd !== 'undefined') closeSync(fd)
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
