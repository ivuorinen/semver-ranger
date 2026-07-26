#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'

import { detectLockfile, isYarnBerry } from './parsers/detect.js'
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
import { flushCache } from './cache/index.js'
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
      const berry = isYarnBerry(lockfilePath)
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

// Node honours these only when started with --use-env-proxy (or
// NODE_USE_ENV_PROXY=1). Both are read during bootstrap, so a running process
// cannot switch proxy support on for itself — the best it can do is say so.
const PROXY_ENV_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
const USE_ENV_PROXY_VAR = 'NODE_USE_ENV_PROXY'

/**
 * Warns when a proxy is configured in the environment but Node is ignoring it.
 *
 * Without this the requests simply fail, and the run reports every package as
 * unresolved with no hint that a one-flag fix exists.
 * @returns {void}
 */
function warnIfProxyIgnored(): void {
  const configured = PROXY_ENV_VARS.some(name => {
    const value = process.env[name]
    return typeof value === 'string' && value !== ''
  })
  if (!configured) return

  const nodeOptions = process.env.NODE_OPTIONS ?? ''
  const honoured =
    process.env[USE_ENV_PROXY_VAR] === '1' ||
    process.execArgv.includes('--use-env-proxy') ||
    nodeOptions.includes('--use-env-proxy')
  if (honoured) return

  console.error(
    'Warning: a proxy is configured in the environment but Node is not using it. ' +
      'Re-run with NODE_USE_ENV_PROXY=1 to route registry requests through it, ' +
      'or pass --offline.'
  )
}

/**
 * Reports a cache-persistence failure without changing the command's outcome.
 * @param {Error | null} failure The failure returned by flushCache, if any.
 * @returns {void}
 */
function warnOnFlushFailure(failure: Error | null): void {
  if (failure !== null) {
    console.error(`Warning: could not persist the registry cache: ${failure.message}`)
  }
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
  let content: string
  let packages: Package[]
  try {
    content = readFileSync(lockfilePath, 'utf8')
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
  let failedLookups = 0
  if (values.offline !== true) {
    warnIfProxyIgnored()
    const progress = createBatchProgress('Fetching registry data', packages.length)
    let lastProgressText = ''
    try {
      const resolved = await resolveRegistry(packages, {
        offline: false,
        onProgress(completed, total, cached) {
          lastProgressText = `Fetching registry data... ${completed}/${total}${
            cached > 0 ? ` (${cached} cached)` : ''
          }`
          progress.update(lastProgressText)
        }
      })
      packages = resolved.packages
      failedLookups = resolved.failed
      progress.succeed(
        lastProgressText || `Fetching registry data... ${packages.length}/${packages.length}`
      )
    } catch (err: unknown) {
      progress.fail('Fetching registry data')
      throw err
    }
  } else {
    const resolved = await resolveRegistry(packages, { offline: true })
    packages = resolved.packages
  }

  // A dropped constraint can only widen the intersection, so unresolved
  // lookups make the reported range too permissive — never say so silently.
  if (failedLookups > 0) {
    console.error(
      `Warning: ${failedLookups} registry lookup(s) failed; ` +
        'the reported ranges may be too permissive.'
    )
  }

  // Analyze
  const engineTargets = analyzeEngines(packages, manager)
  const peerTargetNames = detectPeerTargets(projectDir, values.check ?? [])
  const peerTargets = analyzePeers(packages, peerTargetNames)
  const allTargets = [...engineTargets, ...peerTargets]

  if (allTargets.length === 0 && packages.length > 0) {
    console.error(
      'Warning: no engine or peer constraints resolved. npm lockfileVersion 1 carries no ' +
        'metadata — run without --offline, or install node_modules.'
    )
  }

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
  warnOnFlushFailure(flushCache())
}

main().catch((err: unknown) => {
  // Report the original failure first: a cache write problem must never
  // replace the error the user actually needs to see.
  console.error('Error:', err instanceof Error ? err.message : String(err))
  // Keep whatever was fetched before the failure.
  warnOnFlushFailure(flushCache())
  process.exit(1)
})
