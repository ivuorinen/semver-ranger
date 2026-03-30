import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Package } from '../types.js'

interface PackageManifest {
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/**
 * Reads a package manifest from the local node_modules directory.
 * @param {string} name The package name.
 * @param {string} projectDir The root project directory.
 * @returns {PackageManifest | null} The manifest or null if not found.
 */
function readLocalManifest(name: string, projectDir: string): PackageManifest | null {
  try {
    const pkgPath = join(projectDir, 'node_modules', name, 'package.json')
    const content = readFileSync(pkgPath, 'utf8')
    return JSON.parse(content) as PackageManifest
  } catch {
    return null
  }
}

/**
 * Resolves engine and peer dependency data from local node_modules.
 * @param {Package[]} packages List of packages to resolve.
 * @param {string} projectDir The root project directory.
 * @returns {Promise<Package[]>} Packages enriched with local manifest data.
 */
export async function resolveLocal(packages: Package[], projectDir: string): Promise<Package[]> {
  return packages.map(pkg => {
    const manifest = readLocalManifest(pkg.name, projectDir)
    if (!manifest) return pkg
    return {
      ...pkg,
      engines: manifest.engines ?? pkg.engines,
      peerDependencies: manifest.peerDependencies ?? pkg.peerDependencies
    }
  })
}
