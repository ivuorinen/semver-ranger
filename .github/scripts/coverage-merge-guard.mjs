/**
 * Fails when Node's coverage merge hides a branch that no test executes.
 *
 * The CLI tests spawn child processes, and Node merges the V8 coverage of every
 * process. Its merge (mergeCoverageRanges in lib/internal/test_runner/coverage.js)
 * drops a nested zero-count range once another dump matches the enclosing block
 * exactly, so `npm run cov` reported 100% branches while the `?? pkg.version`
 * fallback in src/analyzer/intersect.ts had never run.
 *
 * Runs coverage without test/cli.test.ts and then in full, both as lcov. A line
 * where the partial run reports a never-taken branch must have at least as many
 * branch entries in the full run: the full run executes a superset of the code,
 * so V8 reports no fewer ranges per line, and only a merge drop lowers the count.
 * Checking presence alone missed a dropped branch that shared its line with a
 * surviving one, such as one arm of `a ?? b`.
 *
 * The check cannot tell a dropped branch the CLI runs from one nothing runs, so
 * a branch reached only through the CLI fails it too: cover it in a unit test.
 */
import { execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI_TESTS = 'test/cli.test.ts'
const out = mkdtempSync(join(tmpdir(), 'coverage-merge-guard-'))

/**
 * Reads lcov branch records per source line.
 * @param {string} lcov The lcov report text.
 * @returns {{zero: Set<string>, counts: Map<string, number>}} `file:line` of each
 * line with a never-taken branch, and the number of branch entries on each line.
 */
function readBranches(lcov) {
  const zero = new Set()
  const counts = new Map()
  let file = ''
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) file = line.slice(3)
    if (!line.startsWith('BRDA:')) continue
    const [lineNumber, , , count] = line.slice(5).split(',')
    const key = `${file}:${lineNumber}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (count === '0') zero.add(key)
  }
  return { zero, counts }
}

/**
 * Runs test files under the cov script's coverage scope and reads the branches.
 * @param {string} name Name for the lcov file.
 * @param {string[]} files The test files to run.
 * @returns {{zero: Set<string>, counts: Map<string, number>}} See readBranches.
 */
function branches(name, files) {
  const lcov = join(out, `${name}.info`)
  execFileSync(
    process.execPath,
    [
      '--experimental-test-coverage',
      '--test-coverage-include=src/**',
      '--test-coverage-exclude=src/types.ts',
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      '--test-reporter=lcov',
      `--test-reporter-destination=${lcov}`,
      '--test',
      ...files
    ],
    { stdio: 'inherit' }
  )
  return readBranches(readFileSync(lcov, 'utf8'))
}

try {
  const files = globSync('test/**/*.test.ts')
  const partial = branches(
    'partial',
    files.filter(file => file !== CLI_TESTS)
  )
  const full = branches('full', files)
  const hidden = [...partial.zero].filter(
    key => (full.counts.get(key) ?? 0) < (partial.counts.get(key) ?? 0)
  )
  if (hidden.length > 0) {
    const list = hidden.map(key => `  ${key}\n`).join('')
    process.stderr.write(`Never-taken branches without ${CLI_TESTS} vanish from the full run,
so the 100% gate passes without anything running them. Cover each in a unit test:
${list}`)
    process.exitCode = 1
  } else {
    process.stdout.write('\nNo never-taken branch is hidden by the coverage merge.\n')
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}
