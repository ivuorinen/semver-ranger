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
import type { Package, LockfileType, ManagerType } from './types.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

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
 * Detects the lockfile, parses packages, resolves registry data,
 * analyzes engine and peer constraints, and renders the output.
 * @returns {Promise<void>} Resolves when analysis and output are complete.
 */
async function main(): Promise<void> {
  const cwd = process.cwd()
  let lockfilePath: string | undefined = positionals[0]
  let lockfileType: LockfileType
  let manager: ManagerType

  if (typeof lockfilePath !== 'undefined') {
    const resolvedPath: string = resolve(cwd, lockfilePath)
    lockfilePath = resolvedPath
    if (existsSync(resolvedPath) !== true) {
      console.error(`Error: lockfile not found: ${resolvedPath}`)
      process.exit(1)
    }
    // Detect type from filename
    const base: string = basename(resolvedPath)
    if (base === 'package-lock.json') {
      lockfileType = 'npm'
      manager = 'npm'
    } else if (base === 'pnpm-lock.yaml') {
      lockfileType = 'pnpm'
      manager = 'pnpm'
    } else if (base === 'yarn.lock') {
      const content: string = readFileSync(resolvedPath, 'utf8')
      const berry: boolean = content.slice(0, 512).includes('__metadata:')
      lockfileType = berry ? 'yarn-berry' : 'yarn-classic'
      manager = 'yarn'
    } else {
      console.error(`Error: unrecognized lockfile: ${base}`)
      process.exit(1)
    }
  } else {
    const detected = detectLockfile(cwd)
    if (detected === null) {
      console.error('Error: no lockfile found in current directory')
      process.exit(1)
    }
    lockfilePath = detected.path
    lockfileType = detected.type
    manager = detected.manager
  }

  const projectDir = dirname(lockfilePath)
  const content = readFileSync(lockfilePath, 'utf8')

  let packages: Package[]
  if (lockfileType === 'npm') {
    packages = parseNpmLockfile(content)
  } else if (lockfileType === 'yarn-classic') {
    packages = parseYarnClassicLockfile(content)
  } else if (lockfileType === 'yarn-berry') {
    packages = parseYarnBerryLockfile(content)
  } else {
    packages = parsePnpmLockfile(content)
  }

  // Pass 1: local node_modules
  packages = await resolveLocal(packages, projectDir)

  // Pass 1.5: filter dev-only packages if --no-dev
  if (values['no-dev'] === true) {
    packages = filterDevPackages(packages, projectDir, content, lockfileType)
  }

  // Pass 2: registry (skipped if --offline)
  packages = await resolveRegistry(packages, {
    offline: values.offline ?? false
  })

  // Analyze
  const engineTargets = analyzeEngines(packages, manager)
  const peerTargetNames = detectPeerTargets(projectDir, (values.check as string[]) ?? [])
  const peerTargets = analyzePeers(packages, peerTargetNames)
  const allTargets = [...engineTargets, ...peerTargets]

  // Render
  const output = renderOutput(
    allTargets,
    packages.length,
    packages,
    basename(lockfilePath),
    manager,
    values.all ?? false,
    values.json ?? false
  )

  console.log(output)
}

main().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
