#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'

import { detectLockfile } from './parsers/detect.js'
import { parseNpmLockfile } from './parsers/npm.js'
import { parseYarnClassicLockfile } from './parsers/yarn-classic.js'
import { parseYarnBerryLockfile } from './parsers/yarn-berry.js'
import { parsePnpmLockfile } from './parsers/pnpm.js'
import { resolveLocal } from './registry/local.js'
import { resolveRegistry } from './registry/client.js'
import { filterDevPackages } from './graph/index.js'
import { analyzeEngines } from './analyzer/engines.js'
import { analyzePeers, detectPeerTargets } from './analyzer/peers.js'
import { renderOutput } from './output/table.js'
import { createPhaseSpinner, createBatchProgress } from './output/progress.js'
import type { Package, ResolvedLockfile, PackageVersion } from './types.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as PackageVersion

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    offline: { type: 'boolean', default: false },
    check: { type: 'string', multiple: true, default: [] },
    'no-dev': { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    version: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false }
  }
})

if (values.version === true) {
  console.log(pkg.version)
  process.exit(0)
}

if (values.help === true) {
  console.log(`semver-ranger — analyze engine and peer dependency constraints

Usage: semver-ranger [lockfile-path] [options]

Options:
  --offline       Skip registry; use node_modules + cache only
  --check <pkg>   Add a package to peer dep analysis (repeatable)
  --no-dev        Exclude devDependencies from analysis
  --all           Show all packages including those with no constraints
  --json          Output raw JSON instead of tables
  --version       Print version and exit
  --help          Print usage and exit

Exit codes: 0 success, 1 unrecoverable error
`)
  process.exit(0)
}

/**
 * Resolves the lockfile path, type, and package manager from a positional arg or auto-detection.
 * @param {string} cwd Current working directory to search for lockfiles.
 * @param {string} [positional] Optional explicit lockfile path from CLI positional argument.
 * @returns {Object} Resolved lockfile info with path, type, and manager.
 * @throws {Error} If the lockfile is not found, unrecognized, or no lockfile exists in cwd.
 */
function resolveLockfile(cwd: string, positional?: string): ResolvedLockfile {
  if (typeof positional === 'string') {
    const lockfilePath = resolve(cwd, positional)
    if (!existsSync(lockfilePath)) {
      throw new Error(`lockfile not found: ${lockfilePath}`)
    }
    const base = basename(lockfilePath)
    if (base === 'package-lock.json') {
      return { lockfilePath, lockfileType: 'npm', manager: 'npm' }
    }
    if (base === 'pnpm-lock.yaml') {
      return { lockfilePath, lockfileType: 'pnpm', manager: 'pnpm' }
    }
    if (base === 'yarn.lock') {
      const content = readFileSync(lockfilePath, 'utf8')
      const berry = content.slice(0, 512).includes('__metadata:')
      return { lockfilePath, lockfileType: berry ? 'yarn-berry' : 'yarn-classic', manager: 'yarn' }
    }
    throw new Error(`unrecognized lockfile: ${base}`)
  }

  const detected = detectLockfile(cwd)
  if (detected === null) {
    throw new Error('no lockfile found in current directory')
  }
  return { lockfilePath: detected.path, lockfileType: detected.type, manager: detected.manager }
}

/**
 * Main CLI entry point: detects lockfile, resolves packages,
 * analyzes constraints, and renders output.
 * @returns {Promise<void>} Resolves when analysis and output are complete.
 */
async function main(): Promise<void> {
  const { lockfilePath, lockfileType, manager } = resolveLockfile(process.cwd(), positionals[0])

  const projectDir = dirname(lockfilePath)
  const lockfileBase = basename(lockfilePath)
  const parseSpinner = createPhaseSpinner(`Parsing ${lockfileBase}`)
  const content = readFileSync(lockfilePath, 'utf8')
  let packages: Package[]
  try {
    if (lockfileType === 'npm') {
      packages = parseNpmLockfile(content)
    } else if (lockfileType === 'yarn-classic') {
      packages = parseYarnClassicLockfile(content)
    } else if (lockfileType === 'yarn-berry') {
      packages = parseYarnBerryLockfile(content)
    } else {
      packages = parsePnpmLockfile(content)
    }
  } catch (err: unknown) {
    parseSpinner.fail(`Parsing ${lockfileBase}`)
    throw err
  }
  parseSpinner.succeed(`Parsed ${lockfileBase} (${packages.length} packages)`)

  // Pass 1: local node_modules
  const localSpinner = createPhaseSpinner('Reading local packages')
  try {
    packages = await resolveLocal(packages, projectDir)
  } catch (err: unknown) {
    localSpinner.fail('Reading local packages')
    throw err
  }
  localSpinner.succeed('Reading local packages')

  // Pass 1.5: filter dev-only packages if --no-dev
  if (values['no-dev'] === true) {
    packages = filterDevPackages(packages, projectDir, content, lockfileType)
  }

  // Pass 2: registry (skipped if --offline)
  if (values.offline !== true) {
    const progress = createBatchProgress('Fetching registry data', packages.length)
    let lastProgressText = ''
    try {
      packages = await resolveRegistry(packages, {
        offline: false,
        onProgress(completed, total, cached) {
          lastProgressText = `Fetching registry data... ${completed}/${total}${
            cached > 0 ? ` (${cached} cached)` : ''
          }`
          progress.update(lastProgressText)
        }
      })
      progress.succeed(
        lastProgressText || `Fetching registry data... ${packages.length}/${packages.length}`
      )
    } catch (err: unknown) {
      progress.fail('Fetching registry data')
      throw err
    }
  } else {
    packages = await resolveRegistry(packages, { offline: true })
  }

  // Analyze
  const engineTargets = analyzeEngines(packages, manager)
  const peerTargetNames = detectPeerTargets(projectDir, values.check ?? [])
  const peerTargets = analyzePeers(packages, peerTargetNames)
  const allTargets = [...engineTargets, ...peerTargets]

  // Render
  const output = renderOutput(
    allTargets,
    packages.length,
    packages,
    basename(lockfilePath),
    manager,
    values.all,
    values.json
  )

  console.log(output)
}

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
