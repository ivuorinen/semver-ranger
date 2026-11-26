#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { inspect, parseArgs } from 'node:util'
import { createRequire } from 'node:module'

import { detectLockfile, lockfileAt, readProjectManifest } from './parsers/detect.ts'
import { parseNpmLockfile } from './parsers/npm.ts'
import { parseYarnClassicLockfile } from './parsers/yarn-classic.ts'
import { parseYarnBerryLockfile } from './parsers/yarn-berry.ts'
import { parsePnpmLockfile } from './parsers/pnpm.ts'
import { resolveLocal } from './registry/local.ts'
import { resolveRegistry, type Failure } from './registry/client.ts'
import { filterDevPackages, filterReadsManifest, filtersAfterRegistry } from './graph/index.ts'
import { analyzeEngines } from './analyzer/engines.ts'
import { analyzePeers, detectPeerTargets } from './analyzer/peers.ts'
import { renderOutput } from './output/table.ts'
import { createPhaseSpinner, createBatchProgress } from './output/progress.ts'
import { flushCache } from './cache/index.ts'
import type { DetectedLockfile, Package, PackageVersion } from './types.ts'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as PackageVersion
const MAX_NAMED_FAILURES = 5

/**
 * Writes a message to stderr without its control characters, newlines aside.
 *
 * Messages carry lockfile names, parser excerpts and paths. The table already
 * strips such text, but stderr printed it raw, so an escape sequence in a
 * lockfile could clear the screen, rewrite earlier output or set the clipboard.
 * @param {string} message The message.
 * @returns {void}
 */
function report(message: string): void {
  console.error(message.replace(/[^\P{Cc}\n]/gu, ''))
}

/**
 * Flattens lockfile or package.json text that a single-line message embeds.
 *
 * report() keeps newlines because parser errors and stack traces span lines, so
 * a newline inside a package name started a stderr line of the lockfile's
 * choosing, such as a counterfeit "all lookups resolved". report() still strips
 * every other control character.
 * @param {string} text Untrusted text.
 * @returns {string} The text with each newline as a space.
 */
function oneLine(text: string): string {
  return text.replaceAll('\n', ' ')
}

/**
 * Names a package or lookup by its resolved identity.
 * @param {{name: string, version: string}} entry A package or failure.
 * @param {string} entry.name The registry name.
 * @param {string} entry.version The version, or `latest` for a latest-release lookup.
 * @returns {string} `name@version`.
 */
function idOf(entry: { name: string; version: string }): string {
  return `${entry.name}@${entry.version}`
}

/**
 * Parses the command line, turning a usage mistake into a one-line error.
 * parseArgs throws on an unknown flag, which otherwise surfaced as a stack trace.
 * @returns {ReturnType<typeof parseArgs>} The parsed values and positionals.
 */
function parseCliArgs() {
  try {
    return parseArgs({
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
  } catch (err: unknown) {
    report(`Error: ${(err as Error).message}`)
    report('Run semver-ranger --help for usage.')
    return process.exit(1)
  }
}

const { values, positionals } = parseCliArgs()

if (values.version === true) {
  console.log(pkg.version)
  process.exit(0)
}

if (values.help === true) {
  console.log(`semver-ranger — analyze engine and peer dependency constraints

Usage: semver-ranger [lockfile-path] [options]

Options:
  --offline       Skip registry; use lockfile, node_modules and cache only
  --check <pkg>   Add a package to peer dep analysis (repeatable)
  --no-dev        Analyze only what a production install includes
  --all           Show packages with no constraints too (table output only)
  --json          Output raw JSON instead of tables
  --version       Print version and exit
  --help          Print usage and exit

Exit codes: 0 success (conflicts included), 1 unrecoverable error,
130 interrupted, 143 terminated
`)
  process.exit(0)
}

/**
 * Resolves the lockfile path, type, and package manager from a positional arg or auto-detection.
 * The file name is mapped by lockfileAt, which auto-detection uses too: with a
 * mapping of its own here, an explicit path and auto-detection could disagree.
 * @param {string} cwd Current working directory to search for lockfiles.
 * @param {string} [positional] Optional explicit lockfile path from CLI positional argument.
 * @returns {DetectedLockfile} Resolved lockfile info with path, type, and manager.
 * @throws {Error} If the lockfile is not found, unrecognized, or no lockfile exists in cwd.
 */
function resolveLockfile(cwd: string, positional?: string): DetectedLockfile {
  if (typeof positional === 'string') {
    const path = resolve(cwd, positional)
    if (!existsSync(path)) {
      throw new Error(`lockfile not found: ${path}`)
    }
    const detected = lockfileAt(path)
    if (detected === null) {
      throw new Error(`unrecognized lockfile: ${basename(path)}`)
    }
    return detected
  }

  const detected = detectLockfile(cwd)
  if (detected === null) {
    throw new Error('no lockfile found in current directory')
  }
  return detected
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

  report(
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
    report(`Warning: could not persist the registry cache: ${failure.message}`)
  }
}

/**
 * Warns that constraints are missing, naming the first few so the user can act on it.
 * @param {string} summary What went unresolved, with its count.
 * @param {Failure[]} failures The lookups whose constraints are unknown.
 * @returns {void}
 */
function warnUnresolved(summary: string, failures: Failure[]): void {
  if (failures.length === 0) return
  const named = failures
    .slice(0, MAX_NAMED_FAILURES)
    .map(failure => oneLine(`${idOf(failure)} (${failure.reason})`))
    .join(', ')
  const more = failures.length - MAX_NAMED_FAILURES
  report(`Warning: ${summary}; the reported ranges may be too permissive.`)
  report(`  ${named}${more > 0 ? `, and ${more} more` : ''}`)
}

/**
 * Tells a bug from a failure the user can act on.
 *
 * The CLI's own failures are plain Errors, and a lockfile that cannot be read or
 * parsed arrives wrapped in one that names it. A TypeError, RangeError or
 * ReferenceError, thrown or wrapped, means malformed input reached code that
 * does not guard against it; printing only its message left a bug report with
 * no file or line to go on.
 * @param {Error} err The failure that ended the run.
 * @returns {boolean} True when the stack is needed to locate the failure.
 */
function isBug(err: Error): boolean {
  const root = err.cause instanceof Error ? err.cause : err
  return root instanceof TypeError || root instanceof RangeError || root instanceof ReferenceError
}

/**
 * Saves the cache and exits when the run is interrupted.
 *
 * The stores reach disk only when a run ends, so Ctrl-C, or a CI job cancelled
 * at its timeout, threw away every registry response fetched so far, and version
 * manifests never expire, so each would have saved a request on every later run.
 * @param {NodeJS.Signals} signal The signal to handle.
 * @param {number} code The exit code, 128 plus the signal number by convention.
 * @returns {void}
 */
function flushOnSignal(signal: NodeJS.Signals, code: number): void {
  process.once(signal, () => {
    warnOnFlushFailure(flushCache())
    process.exit(code)
  })
}

/**
 * Main CLI entry point: detects lockfile, resolves packages,
 * analyzes constraints, and renders output.
 *
 * A lockfile that cannot be read or parsed fails with its path in the message:
 * the spinner that named it is silent off a terminal, and a JSON parser's
 * position alone left CI logs guessing which file was broken.
 * @returns {Promise<void>} Resolves when analysis and output are complete.
 */
async function main(): Promise<void> {
  flushOnSignal('SIGINT', 130)
  flushOnSignal('SIGTERM', 143)
  const {
    path: lockfilePath,
    type: lockfileType,
    manager
  } = resolveLockfile(process.cwd(), positionals[0])

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
    throw new Error(`could not read ${lockfilePath}: ${(err as Error).message}`, { cause: err })
  }
  parseSpinner.succeed(`Parsed ${lockfileBase} (${packages.length} packages)`)

  // Pass 1: local node_modules
  const localSpinner = createPhaseSpinner('Reading local packages')
  packages = resolveLocal(packages, projectDir)
  localSpinner.succeed('Reading local packages')

  const manifest = readProjectManifest(projectDir)

  // Pass 1.5: filter dev-only packages if --no-dev. For a format whose filter
  // reads package.json, carrying on without it would label an unfiltered result
  // as production-only.
  const filterAfterRegistry = filtersAfterRegistry(lockfileType)
  if (values['no-dev'] === true && manifest.deps === null && filterReadsManifest(lockfileType)) {
    const reason = manifest.error === null ? '' : `: ${oneLine(manifest.error)}`
    throw new Error(`--no-dev needs a readable package.json in ${projectDir}${reason}`)
  }
  if (manifest.error !== null) {
    report(`Warning: skipping peer detection, package.json is unusable: ${oneLine(manifest.error)}`)
  }
  if (values['no-dev'] === true && !filterAfterRegistry) {
    packages = filterDevPackages(packages, projectDir, content, lockfileType)
  }

  // Pass 2: registry (skipped if --offline)
  let failures: Failure[]
  let skipped: Package[] = []
  let latestUncached: Package[] = []
  if (values.offline !== true) {
    warnIfProxyIgnored()
    const progress = createBatchProgress('Fetching registry data', packages.length)
    let lastProgressText = ''
    try {
      const resolved = await resolveRegistry(packages, {
        offline: false,
        projectDir,
        onProgress(completed, total, cached) {
          lastProgressText = `Fetching registry data... ${completed}/${total}${
            cached > 0 ? ` (${cached} cached)` : ''
          }`
          progress.update(lastProgressText)
        }
      })
      packages = resolved.packages
      failures = resolved.failures
      skipped = resolved.skipped
      progress.succeed(
        lastProgressText || `Fetching registry data... ${packages.length}/${packages.length}`
      )
    } catch (err: unknown) {
      progress.fail('Fetching registry data')
      throw err
    }
  } else {
    const resolved = await resolveRegistry(packages, { offline: true, projectDir })
    packages = resolved.packages
    failures = resolved.failures
    latestUncached = resolved.latestUncached
  }

  if (values['no-dev'] === true && filterAfterRegistry) {
    packages = filterDevPackages(packages, projectDir, content, lockfileType)
    // The registry pass also saw the dev packages just removed. Reporting their
    // lookups said the ranges might be too permissive because of packages the
    // analysis no longer includes.
    const kept = new Set(packages.map(idOf))
    const names = new Set(packages.map(({ name }) => name))
    failures = failures.filter(failure =>
      failure.version === 'latest' ? names.has(failure.name) : kept.has(idOf(failure))
    )
    skipped = skipped.filter(entry => kept.has(idOf(entry)))
    latestUncached = latestUncached.filter(entry => kept.has(idOf(entry)))
  }

  // A dropped constraint can only widen the intersection, so unresolved
  // lookups make the reported range too permissive — never say so silently.
  warnUnresolved(
    values.offline === true
      ? `${failures.length} package(s) have no metadata offline`
      : `${failures.length} registry lookup(s) failed`,
    failures
  )
  if (skipped.length > 0) {
    report(
      `Warning: the registry stopped responding, so ${skipped.length} package(s) were not ` +
        'looked up. Re-run when it is reachable, or pass --offline.'
    )
  }
  // Offline, latest entries a day old have expired; the latest ranges then
  // looked complete, or said "no constraints found", when they were unknown.
  if (latestUncached.length > 0) {
    report(
      `Warning: latest data is not cached for ${latestUncached.length} package(s); ` +
        'the latest ranges are partial.'
    )
  }

  // Analyze
  const engineTargets = analyzeEngines(packages, manager)
  const peerTargetNames = detectPeerTargets(manifest.deps, values.check)
  const peerTargets = analyzePeers(packages, peerTargetNames)
  const allTargets = [...engineTargets, ...peerTargets]

  if (allTargets.length === 0 && packages.length > 0) {
    const hint = values.offline === true ? ' Run without --offline, or install node_modules.' : ''
    report(`Warning: no engine or peer constraints were resolved.${hint}`)
  }

  // Render. JSON carries every sign of an incomplete analysis as well: on stderr
  // alone, a script read one whose every lookup failed, or whose latest data had
  // expired offline, as a clean result.
  const analysis = {
    targets: allTargets,
    unresolved: failures,
    skipped: skipped.length,
    latestUncached: latestUncached.length
  }
  const output =
    values.json === true
      ? JSON.stringify(analysis, null, 2)
      : renderOutput(allTargets, packages, lockfileBase, manager, values.all)

  console.log(output)
  warnOnFlushFailure(flushCache())
}

main().catch((err: unknown) => {
  // Report the original failure first: a cache write problem must never
  // replace the error the user actually needs to see.
  const error = err as Error
  report(isBug(error) ? inspect(error) : `Error: ${error.message}`)
  // Keep whatever was fetched before the failure.
  warnOnFlushFailure(flushCache())
  process.exit(1)
})
