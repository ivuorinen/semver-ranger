import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { RequestListener, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts')
const USERCONFIG_ENV = 'npm_config_userconfig'
const REGISTRY_ENV = 'npm_config_registry'
const root = mkdtempSync(join(tmpdir(), 'semver-ranger-cli-'))
let projects = 0

interface Run {
  code: number
  stdout: string
  stderr: string
}

/**
 * Creates a project directory holding the given files.
 * @param {Record<string, string>} files File contents by relative path.
 * @returns {string} The project directory.
 */
function project(files: Record<string, string>): string {
  projects += 1
  const dir = join(root, String(projects))
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content)
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Serialises an npm v3 lockfile with the given package entries.
 * @param {Record<string, unknown>} packages Entries keyed by install path.
 * @returns {string} The lockfile text.
 */
function lockfile(packages: Record<string, unknown>): string {
  return JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } })
}

interface JsonReport {
  targets: { name: string; source: string; intersection: string | null }[]
  unresolved: { name: string; version: string; reason: string }[]
  skipped: number
  latestUncached: number
}

/**
 * Reads the --json output.
 * @param {string} stdout The CLI's standard output.
 * @returns {JsonReport} The parsed report.
 */
function parseJson(stdout: string): JsonReport {
  return JSON.parse(stdout) as JsonReport
}

/**
 * Runs the CLI in a child process, with the user's npm configuration kept out.
 * @param {string} cwd Working directory.
 * @param {string[]} args Command-line arguments.
 * @param {Record<string, string>} env Extra environment variables.
 * @param {string[]} nodeArgs Flags for node itself, placed before the script.
 * @returns {Promise<Run>} The exit code and both output streams.
 */
function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  nodeArgs: string[] = []
): Promise<Run> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      ['--no-warnings', ...nodeArgs, CLI, ...args],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          XDG_CACHE_HOME: join(cwd, '.cache'),
          [USERCONFIG_ENV]: join(cwd, 'no-such-npmrc'),
          ...env
        }
      },
      (err, stdout, stderr) => {
        resolve({ code: typeof err?.code === 'number' ? err.code : 0, stdout, stderr })
      }
    )
  })
}

/**
 * Builds a node flag that runs code in the child before the CLI loads.
 * @param {string} code The code to run.
 * @returns {string} The flag.
 */
function preload(code: string): string {
  return `--import=data:text/javascript,${encodeURIComponent(code)}`
}

// Progress is only drawn on a terminal, which a piped child does not have.
const TERMINAL = preload('process.stderr.isTTY = true; process.stderr.columns = 200')

/**
 * Starts a local registry stand-in.
 * @param {RequestListener} handler Handles each request.
 * @returns {Promise<{server: Server, url: string}>} The server and its base URL.
 */
function serve(handler: RequestListener): Promise<{ server: Server; url: string }> {
  return new Promise(resolve => {
    const server = createServer(handler).listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * Runs a test body against a local registry stand-in.
 * @param {RequestListener} handler Handles each request.
 * @param {Function} body Receives the registry's base URL.
 * @returns {Promise<void>} Resolves once the body has finished and the server closed.
 */
async function withRegistry(
  handler: RequestListener,
  body: (url: string) => Promise<void>
): Promise<void> {
  const { server, url } = await serve(handler)
  try {
    await body(url)
  } finally {
    server.close()
  }
}

const found: RequestListener = (_req, res) => {
  res.end('{"version":"1.0.0"}')
}

const notFound: RequestListener = (_req, res) => {
  res.statusCode = 404
  res.end('{}')
}

const ONE_PACKAGE = lockfile({ 'node_modules/a': { version: '1.0.0' } })

after(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('command line', () => {
  it('prints the version from package.json and exits 0', async () => {
    const manifest = readFileSync(join(dirname(CLI), '../package.json'), 'utf8')
    const { version } = JSON.parse(manifest) as { version: string }
    const result = await run(project({}), ['--version'])
    assert.strictEqual(result.code, 0)
    assert.strictEqual(result.stdout.trim(), version)
  })

  it('prints usage and exits 0', async () => {
    const result = await run(project({}), ['--help'])
    assert.strictEqual(result.code, 0)
    assert.match(result.stdout, /Usage: semver-ranger \[lockfile-path\] \[options\]/u)
    for (const flag of ['--offline', '--check', '--no-dev', '--all', '--json', '--version']) {
      assert.ok(result.stdout.includes(flag), `usage does not mention ${flag}`)
    }
  })

  it('exits 1 with a message when there is no lockfile', async () => {
    const result = await run(project({}), [])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /Error: no lockfile found/u)
  })

  it('reports an unknown flag without a stack trace', async () => {
    const result = await run(project({}), ['--bogus'])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /Error: Unknown option '--bogus'/u)
    assert.match(result.stderr, /Run semver-ranger --help for usage\./u)
    assert.ok(!result.stderr.includes('node:internal'), result.stderr)
  })

  it('analyses a lockfile offline as JSON and warns about nothing', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/a': { version: '1.0.0', engines: { node: '>=20' } }
      }),
      '.cache/semver-ranger/latest.json': JSON.stringify({
        a: { data: { version: '1.0.0' }, cachedAt: Date.now() }
      })
    })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.strictEqual(result.stderr, '')
    const { targets, unresolved, skipped, latestUncached } = parseJson(result.stdout)
    assert.strictEqual(targets[0]?.name, 'node')
    assert.strictEqual(targets[0]?.intersection, '>=20.0.0')
    assert.deepStrictEqual([unresolved, skipped, latestUncached], [[], 0, 0])
  })

  // Regression: an expired latest cache reached stderr only, so a script read
  // latest ranges computed from some of the packages as complete.
  it('counts packages with no cached latest data in the JSON output', async () => {
    const dir = project({ 'package-lock.json': ONE_PACKAGE })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.strictEqual(parseJson(result.stdout).latestUncached, 1)
  })

  it('renders a non-string range instead of failing', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/a': { version: '1.0.0', engines: { node: 18 } }
      })
    })
    const result = await run(dir, ['--offline'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('Unparseable ranges'))
  })

  it('adds a package named by --check to the peer analysis', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/a': { version: '1.0.0', peerDependencies: { custom: '^1.2.0' } }
      })
    })
    const result = await run(dir, ['--offline', '--json', '--check', 'custom'])
    assert.strictEqual(result.code, 0, result.stderr)
    const custom = parseJson(result.stdout).targets.find(target => target.name === 'custom')
    assert.strictEqual(custom?.source, 'peerDependencies')
    assert.strictEqual(custom?.intersection, '>=1.2.0 <2.0.0-0')
  })

  it('lists unconstrained packages only with --all', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/constrained': { version: '1.0.0', engines: { node: '>=20' } },
        'node_modules/free': { version: '2.0.0' }
      })
    })
    const heading = 'All packages (no constraint declared):'
    const without = await run(dir, ['--offline'])
    assert.ok(!without.stdout.includes(heading))
    const withAll = await run(dir, ['--offline', '--all'])
    assert.ok(withAll.stdout.includes(heading))
    assert.ok(withAll.stdout.includes(`${'  free'.padEnd(28)}${'2.0.0'.padEnd(12)}`))
  })
})

describe('choosing a lockfile', () => {
  const formats = [
    ['npm', 'package-lock.json', ONE_PACKAGE, 'npm'],
    // Regression: neither auto-detection nor an explicit path accepted a shrinkwrap.
    ['npm shrinkwrap', 'npm-shrinkwrap.json', ONE_PACKAGE, 'npm'],
    ['pnpm', 'pnpm-lock.yaml', "lockfileVersion: '9.0'\nsnapshots:\n  a@1.0.0: {}\n", 'pnpm'],
    ['yarn classic', 'yarn.lock', 'a@^1:\n  version "1.0.0"\n', 'yarn'],
    [
      'yarn berry',
      'yarn.lock',
      '__metadata:\n  version: 8\n\n"a@npm:^1":\n  version: 1.0.0\n',
      'yarn'
    ]
  ] as const

  // Any other parser finds no packages here or throws, so the count proves which one ran.
  for (const [label, file, content, manager] of formats) {
    it(`parses a ${label} lockfile found in the working directory`, async () => {
      const result = await run(project({ [file]: content }), ['--offline'])
      assert.strictEqual(result.code, 0, result.stderr)
      assert.match(result.stdout, /analyzing 1 packages/u)
      assert.ok(result.stdout.includes(`${file} (${manager})`), result.stdout)
    })

    // --no-dev looks the format up by name, so a wrong type fails here.
    it(`parses and filters a ${label} lockfile given by path`, async () => {
      const dir = project({
        [`sub/${file}`]: content,
        'sub/package.json': '{"dependencies":{"a":"^1"}}'
      })
      const result = await run(dir, [`sub/${file}`, '--offline', '--no-dev'])
      assert.strictEqual(result.code, 0, result.stderr)
      assert.match(result.stdout, /analyzing 1 packages/u)
      assert.ok(result.stdout.includes(`${file} (${manager})`), result.stdout)
    })
  }

  it('reads node_modules next to a lockfile given by path', async () => {
    const dir = project({
      'sub/package-lock.json': ONE_PACKAGE,
      'sub/node_modules/a/package.json': '{"version":"1.0.0","engines":{"node":">=22"}}'
    })
    const result = await run(dir, ['sub/package-lock.json', '--offline', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    const [target] = parseJson(result.stdout).targets
    assert.strictEqual(target?.intersection, '>=22.0.0')
  })

  it('fails on a path that does not exist', async () => {
    const result = await run(project({}), ['missing/package-lock.json'])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /Error: lockfile not found: .*missing\/package-lock\.json/u)
  })

  it('refuses a file that is not a known lockfile', async () => {
    const result = await run(project({ 'notes.txt': 'hello' }), ['notes.txt'])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /Error: unrecognized lockfile: notes\.txt/u)
  })

  it('closes the parsing line and exits 1 on a malformed lockfile', async () => {
    const result = await run(project({ 'package-lock.json': '{ nope' }), [], {}, [TERMINAL])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /✖\S* Parsing package-lock\.json\n/u)
    assert.match(result.stderr, /Error: .*JSON/u)
  })
})

describe('error reports', () => {
  const NOT_PRINTABLE = /[^\P{Cc}\n]/u

  // Regression: report() keeps newlines, so a newline inside a package name
  // started a stderr line the lockfile chose. NOT_PRINTABLE exempts \n, so the
  // escape tests below could not see it.
  it('keeps a newline in a lockfile name from starting a line of its own', async () => {
    const forged = 'Warning: all 312 lookups resolved; ranges are exact.'
    const dir = project({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 1,
        dependencies: { [`evil\n${forged}`]: { version: '1.0.0' } }
      })
    })
    const result = await run(dir, ['--offline'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.ok(result.stderr.includes(`evil ${forged}@1.0.0 (no metadata)`), result.stderr)
    assert.ok(!result.stderr.split('\n').some(line => line.startsWith(forged)), result.stderr)
  })

  // Regression: lockfile text reached stderr raw, so a package name could clear
  // the screen or write the clipboard through an escape sequence.
  it('strips terminal escapes from a lockfile name in a warning', async () => {
    const name = 'evil\u001b]52;c;aGFja2Vk\u0007\u001b[2J'
    const dir = project({ 'yarn.lock': `"${name}@^1.0.0":\n  version "1.0.0"\n` })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.ok(result.stderr.includes('evil]52;c;aGFja2Vk[2J@1.0.0 (no metadata)'), result.stderr)
    assert.doesNotMatch(result.stderr, NOT_PRINTABLE)
  })

  it('strips terminal escapes from a parser error that quotes the lockfile', async () => {
    const dir = project({
      'pnpm-lock.yaml':
        "lockfileVersion: '9.0'\nsnapshots:\n  a: b: \u001b]0;pwned\u0007\u001b[2J\n"
    })
    const result = await run(dir, ['--offline'])
    assert.strictEqual(result.code, 1)
    assert.ok(result.stderr.includes(']0;pwned[2J'), result.stderr)
    assert.doesNotMatch(result.stderr, NOT_PRINTABLE)
  })

  // Regression: off a terminal the parsing line is not drawn, and the error gave
  // only a JSON position, never the file.
  it('names the lockfile it could not parse when stderr is not a terminal', async () => {
    const dir = project({ 'package-lock.json': '{"lockfileVersion": 3, "packages": {' })
    const result = await run(dir, ['--offline'])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /^Error: could not read \S*package-lock\.json: .*JSON/u)
    assert.ok(!result.stderr.includes('    at '), result.stderr)
  })

  // Regression: only a TypeError's message was printed, so a crash on an unusual
  // lockfile left a bug report with no file or line.
  it('prints the stack of a programming error', async () => {
    const crash = preload("console.log = () => { throw new TypeError('injected') }")
    const dir = project({ 'package-lock.json': ONE_PACKAGE })
    const result = await run(dir, ['--offline'], {}, [crash])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /^TypeError: injected\n\s+at /mu)
    assert.match(result.stderr, /cli\.ts:\d+/u)
  })

  it('prints the stack of a programming error raised while parsing, and the file', async () => {
    const crash = preload(
      'const parse = JSON.parse; JSON.parse = (text, ...rest) => { ' +
        "if (String(text).includes('crash')) throw new TypeError('injected'); " +
        'return parse(text, ...rest) }'
    )
    const dir = project({
      'package-lock.json': lockfile({ 'node_modules/crash': { version: '1.0.0' } })
    })
    const result = await run(dir, ['--offline'], {}, [crash])
    assert.strictEqual(result.code, 1)
    assert.match(result.stderr, /^Error: could not read \S*package-lock\.json: injected\n\s+at /u)
    assert.match(result.stderr, /\[cause\]: TypeError: injected\n\s+at /u)
  })
})

describe('terminal width', () => {
  const separators = (stdout: string) => stdout.split('\n').filter(line => /^─+$/u.test(line))

  it('assumes 80 columns when stdout is not a terminal', async () => {
    const result = await run(project({ 'package-lock.json': ONE_PACKAGE }), ['--offline'])
    assert.deepStrictEqual([...new Set(separators(result.stdout))], ['─'.repeat(80)])
  })

  // A pseudo-terminal allocated without a size reports 0 columns.
  for (const [columns, expected] of [
    [0, 80],
    [120, 120]
  ]) {
    it(`draws ${expected} columns when the terminal reports ${columns}`, async () => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const flag = preload(`process.stdout.columns = ${columns}`)
      const result = await run(dir, ['--offline'], {}, [flag])
      assert.deepStrictEqual([...new Set(separators(result.stdout))], ['─'.repeat(expected)])
    })
  }

  // Too narrow for the other columns, the range column keeps its 20-column floor.
  it('keeps the range column 20 wide on a 60-column terminal', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/a': { version: '1.0.0', engines: { node: 'x'.repeat(25) } }
      })
    })
    const result = await run(dir, ['--offline'], {}, [preload('process.stdout.columns = 60')])
    const lines = result.stdout.split('\n')
    const columns = `${'  a'.padEnd(28)}${'1.0.0'.padEnd(12)}${'—'.padEnd(12)}`
    const row = lines.indexOf(`${columns}${'x'.repeat(20)}`)
    assert.notStrictEqual(row, -1, result.stdout)
    assert.strictEqual(lines[row + 1], `${' '.repeat(columns.length)}${'x'.repeat(5)}`)
  })
})

describe('--no-dev', () => {
  const packages = lockfile({
    'node_modules/prod': { version: '1.0.0', engines: { node: '>=10' } },
    'node_modules/tool': { version: '1.0.0', dev: true, engines: { node: '>=99' } }
  })

  it('reads package.json next to the lockfile, not in the working directory', async () => {
    const engines = (node: string): string =>
      JSON.stringify({ version: '1.0.0', engines: { node } })
    const dir = project({
      'sub/yarn.lock': 'prod@^1:\n  version "1.0.0"\n\ntool@^1:\n  version "1.0.0"\n',
      'sub/package.json': '{"dependencies":{"prod":"^1"},"devDependencies":{"tool":"^1"}}',
      'sub/node_modules/prod/package.json': engines('>=10'),
      'sub/node_modules/tool/package.json': engines('>=99')
    })
    const result = await run(dir, ['sub/yarn.lock', '--offline', '--no-dev', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    const [target] = parseJson(result.stdout).targets
    assert.strictEqual(target?.intersection, '>=10.0.0')
  })

  it('removes dev-only packages from the result', async () => {
    const dir = project({
      'package-lock.json': packages,
      'package.json': JSON.stringify({
        dependencies: { prod: '^1' },
        devDependencies: { tool: '^1' }
      })
    })
    const result = await run(dir, ['--offline', '--no-dev', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    const [target] = parseJson(result.stdout).targets
    assert.strictEqual(target?.intersection, '>=10.0.0')
  })

  // Regression: yarn.lock records no peers, so without node_modules the filter ran
  // before the registry supplied react-dom's and dropped react.
  it('keeps a dev dependency that a Yarn Classic production package names as a peer', async () => {
    const manifests: Record<string, object> = {
      'react-dom': { version: '18.2.0', peerDependencies: { react: '^18.2.0' } },
      react: { version: '18.2.0', engines: { node: '>=0.10.0' } }
    }
    const answer: RequestListener = (req, res) => {
      res.end(JSON.stringify(manifests[String(req.url).split('/')[1] ?? '']))
    }
    await withRegistry(answer, async url => {
      const dir = project({
        'yarn.lock':
          'react-dom@^18.2.0:\n  version "18.2.0"\n\nreact@^18.2.0:\n  version "18.2.0"\n',
        'package.json': JSON.stringify({
          dependencies: { 'react-dom': '^18.2.0' },
          devDependencies: { react: '^18.2.0' }
        })
      })
      const result = await run(dir, ['--no-dev', '--json'], { [REGISTRY_ENV]: url })
      assert.strictEqual(result.code, 0, result.stderr)
      const node = parseJson(result.stdout).targets.find(target => target.name === 'node')
      assert.strictEqual(node?.intersection, '>=0.10.0')
    })
  })

  const yarnLocks: [string, string][] = [
    ['Yarn Classic', 'prod@^1:\n  version "1.0.0"\n'],
    [
      'Yarn Berry',
      '__metadata:\n  version: 8\n\n' +
        '"prod@npm:^1":\n  version: 1.0.0\n  resolution: "prod@npm:1.0.0"\n'
    ]
  ]
  for (const [format, lock] of yarnLocks) {
    it(`fails for ${format} without package.json rather than leave dev packages in`, async () => {
      const result = await run(project({ 'yarn.lock': lock }), ['--offline', '--no-dev', '--json'])
      assert.strictEqual(result.code, 1)
      assert.match(result.stderr, /--no-dev needs a readable package\.json in \S+\n/u)
    })

    it(`fails for ${format} on an unparseable package.json`, async () => {
      const dir = project({ 'yarn.lock': lock, 'package.json': '{ not json' })
      const result = await run(dir, ['--offline', '--no-dev', '--json'])
      assert.strictEqual(result.code, 1)
      assert.match(result.stderr, /--no-dev needs a readable package\.json in .*: .*JSON/u)
    })
  }

  // Regression: --no-dev demanded package.json for every format, although npm's
  // filter reads the lockfile's dev flags and pnpm's reads its importers.
  const PNPM_LOCK = [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    dependencies:',
    '      prod: {specifier: ^1, version: 1.0.0}',
    '    devDependencies:',
    '      tool: {specifier: ^1, version: 1.0.0}',
    'packages:',
    "  prod@1.0.0: {engines: {node: '>=10'}}",
    "  tool@1.0.0: {engines: {node: '>=99'}}",
    'snapshots:',
    '  prod@1.0.0: {}',
    '  tool@1.0.0: {}',
    ''
  ].join('\n')
  const lockfileOnly: [string, Record<string, string>][] = [
    ['npm', { 'package-lock.json': packages }],
    ['pnpm', { 'pnpm-lock.yaml': PNPM_LOCK }]
  ]
  for (const [format, files] of lockfileOnly) {
    it(`filters a ${format} lockfile with no package.json beside it`, async () => {
      const result = await run(project(files), ['--offline', '--no-dev', '--json'])
      assert.strictEqual(result.code, 0, result.stderr)
      const [target] = parseJson(result.stdout).targets
      assert.strictEqual(target?.intersection, '>=10.0.0')
    })
  }

  it('filters an npm lockfile and warns when package.json is unparseable', async () => {
    const dir = project({ 'package-lock.json': packages, 'package.json': '{ not json' })
    const result = await run(dir, ['--offline', '--no-dev', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.match(result.stderr, /skipping peer detection, package\.json is unusable/u)
    assert.strictEqual(parseJson(result.stdout).targets[0]?.intersection, '>=10.0.0')
  })

  // Regression: Yarn Classic filters after the registry pass, and the lookups of
  // the dev packages it then removed were still reported as unresolved.
  it('reports only the lookups of packages the Yarn Classic filter keeps', async () => {
    const dir = project({
      'yarn.lock': 'a@^1.0.0:\n  version "1.0.0"\n\nb@^1.0.0:\n  version "1.0.0"\n',
      'package.json': JSON.stringify({
        dependencies: { a: '^1.0.0' },
        devDependencies: { b: '^1.0.0' }
      })
    })
    const result = await run(dir, ['--offline', '--no-dev', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    const { unresolved, latestUncached } = parseJson(result.stdout)
    assert.deepStrictEqual(unresolved, [{ name: 'a', version: '1.0.0', reason: 'no metadata' }])
    assert.strictEqual(latestUncached, 1)
    assert.match(result.stderr, /1 package\(s\) have no metadata offline/u)
    assert.match(result.stderr, /latest data is not cached for 1 package\(s\)/u)
  })

  it('keeps a failed latest lookup of a package the Yarn Classic filter keeps', async () => {
    await withRegistry(notFound, async url => {
      const dir = project({
        'yarn.lock': 'a@^1.0.0:\n  version "1.0.0"\n\nb@^1.0.0:\n  version "1.0.0"\n',
        'package.json': JSON.stringify({
          dependencies: { a: '^1.0.0' },
          devDependencies: { b: '^1.0.0' }
        })
      })
      const result = await run(dir, ['--no-dev', '--json'], { [REGISTRY_ENV]: url })
      assert.strictEqual(result.code, 0, result.stderr)
      assert.deepStrictEqual(parseJson(result.stdout).unresolved, [
        { name: 'a', version: '1.0.0', reason: 'HTTP 404' },
        { name: 'a', version: 'latest', reason: 'HTTP 404' }
      ])
    })
  })

  // At a stalled registry the breaker leaves the twelfth package unlooked-up; it is
  // the dev one, so after the Yarn Classic filter nothing analysed was skipped.
  it('does not count a dev package the Yarn Classic filter removes as skipped', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}`)
    const stalled = preload(
      "globalThis.fetch = () => Promise.reject(new DOMException('slow', 'TimeoutError'))"
    )
    const dir = project({
      'yarn.lock': names.map(name => `${name}@^1:\n  version "1.0.0"\n`).join('\n'),
      'package.json': JSON.stringify({
        dependencies: Object.fromEntries(names.slice(0, 11).map(name => [name, '^1'])),
        devDependencies: { p11: '^1' }
      })
    })
    const result = await run(dir, ['--no-dev', '--json'], {}, [stalled])
    assert.strictEqual(result.code, 0, result.stderr)
    const { unresolved, skipped } = parseJson(result.stdout)
    assert.deepStrictEqual([unresolved.length, skipped], [22, 0])
    assert.ok(!result.stderr.includes('not looked up'), result.stderr)
  })
})

describe('warnings about missing constraints', () => {
  const classic = (count: number): string =>
    Array.from({ length: count }, (_, i) => `p${i}@^1:\n  version "1.0.0"\n`).join('\n')

  it('still runs, and warns, when package.json is unparseable', async () => {
    const dir = project({
      'package-lock.json': ONE_PACKAGE,
      'package.json': '{ not json'
    })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0)
    assert.match(result.stderr, /skipping peer detection/u)
  })

  it('warns offline about a package nothing can vouch for', async () => {
    const dir = project({
      'yarn.lock': 'a@^1:\n  version "1.0.0"\n\nb@^1:\n  version "1.0.0"\n',
      'node_modules/a/package.json': '{"version":"1.0.0","engines":{"node":">=10"}}'
    })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0)
    assert.match(result.stderr, /1 package\(s\) have no metadata offline/u)
    assert.match(result.stderr, /b@1\.0\.0 \(no metadata\)/u)
  })

  it('names all five when exactly five are unresolved', async () => {
    const result = await run(project({ 'yarn.lock': classic(5) }), ['--offline', '--json'])
    assert.match(result.stderr, /5 package\(s\) have no metadata offline/u)
    const named = [0, 1, 2, 3, 4].map(i => `p${i}@1.0.0 (no metadata)`).join(', ')
    assert.ok(result.stderr.includes(`  ${named}\n`), result.stderr)
    assert.ok(!result.stderr.includes('more'), result.stderr)
  })

  it('names five and counts the rest', async () => {
    const result = await run(project({ 'yarn.lock': classic(7) }), ['--offline', '--json'])
    assert.match(result.stderr, /7 package\(s\) have no metadata offline/u)
    assert.match(result.stderr, /p4@1\.0\.0 \(no metadata\), and 2 more\n/u)
    assert.ok(!result.stderr.includes('p5@'), result.stderr)
  })

  // Regression: offline, the latest range was built from whichever packages had a
  // cached latest entry, and nothing said the others were missing.
  it('warns offline when latest data is not cached for every package', async () => {
    const dir = project({
      'package-lock.json': lockfile({
        'node_modules/a': { version: '1.0.0' },
        'node_modules/b': { version: '1.0.0' }
      }),
      '.cache/semver-ranger/versions.json': JSON.stringify({
        'a@1.0.0': { engines: { node: '>=14' } },
        'b@1.0.0': { engines: { node: '>=16' } }
      }),
      '.cache/semver-ranger/latest.json': JSON.stringify({
        a: { data: { version: '2.0.0', engines: { node: '>=18' } }, cachedAt: Date.now() }
      })
    })
    const result = await run(dir, ['--offline', '--json'])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.strictEqual(
      result.stderr,
      'Warning: latest data is not cached for 1 package(s); the latest ranges are partial.\n'
    )
  })

  it('names the lookups that failed', async () => {
    await withRegistry(notFound, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url })
      assert.strictEqual(result.code, 0)
      assert.match(result.stderr, /2 registry lookup\(s\) failed/u)
      assert.match(result.stderr, /a@1\.0\.0 \(HTTP 404\)/u)
    })
  })

  // Regression: --json carried no sign of failed lookups, so a script read an
  // analysis whose every lookup failed as a clean, unconstrained one.
  it('lists the failed lookups in the JSON output', async () => {
    await withRegistry(notFound, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url })
      assert.strictEqual(result.code, 0)
      const { unresolved, skipped } = parseJson(result.stdout)
      assert.deepStrictEqual(unresolved, [
        { name: 'a', version: '1.0.0', reason: 'HTTP 404' },
        { name: 'a', version: 'latest', reason: 'HTTP 404' }
      ])
      assert.strictEqual(skipped, 0)
    })
  })

  it('does not blame npm v1 for an empty analysis of another lockfile', async () => {
    const dir = project({ 'yarn.lock': 'a@^1:\n  version "1.0.0"\n' })
    const result = await run(dir, ['--offline', '--json'])
    assert.match(result.stderr, /no engine or peer constraints were resolved\./u)
    assert.match(result.stderr, /Run without --offline, or install node_modules\./u)
    assert.ok(!result.stderr.includes('lockfileVersion'), result.stderr)
  })

  it('does not suggest dropping --offline to a run that was online', async () => {
    await withRegistry(found, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url })
      assert.match(result.stderr, /no engine or peer constraints were resolved\.\n/u)
      assert.ok(!result.stderr.includes('--offline'), result.stderr)
    })
  })

  it('says nothing about constraints when there are no packages', async () => {
    const result = await run(project({ 'package-lock.json': lockfile({}) }), ['--offline'])
    assert.strictEqual(result.stderr, '')
  })
})

describe('registry selection', () => {
  it('sends a scoped package to the registry .npmrc names for its scope', async () => {
    const seen: string[] = []
    const answer: RequestListener = (req, res) => {
      seen.push(String(req.url))
      res.end('{"version":"1.0.0"}')
    }
    const failing: RequestListener = (_req, res) => {
      res.statusCode = 500
      res.end('{}')
    }
    await withRegistry(answer, async scoped => {
      await withRegistry(failing, async other => {
        const dir = project({
          'package-lock.json': lockfile({ 'node_modules/@acme/secret': { version: '1.0.0' } }),
          '.npmrc': `registry=${other}/\n@acme:registry=${scoped}/\n`
        })
        const result = await run(dir, ['--json'])
        assert.strictEqual(result.code, 0)
        assert.ok(!result.stderr.includes('failed'), result.stderr)
        assert.deepStrictEqual(seen.toSorted(), ['/@acme%2Fsecret/1.0.0', '/@acme%2Fsecret/latest'])
      })
    })
  })
})

describe('proxy configuration', () => {
  const WARNING = /a proxy is configured in the environment but Node is not using it/u
  const PROXY = 'http://127.0.0.1:9'

  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    it(`warns that Node is ignoring ${name}`, async () => {
      await withRegistry(found, async url => {
        const dir = project({ 'package-lock.json': ONE_PACKAGE })
        const result = await run(dir, ['--json'], { [name]: PROXY, [REGISTRY_ENV]: url })
        assert.strictEqual(result.code, 0)
        assert.match(result.stderr, WARNING)
        const advice =
          'Re-run with NODE_USE_ENV_PROXY=1 to route registry requests through it, ' +
          'or pass --offline.'
        assert.ok(result.stderr.includes(advice), result.stderr)
      })
    })
  }

  it('treats an empty proxy variable as unset', async () => {
    await withRegistry(found, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const result = await run(dir, ['--json'], { HTTPS_PROXY: '', [REGISTRY_ENV]: url })
      assert.doesNotMatch(result.stderr, WARNING)
    })
  })

  it('does not warn on an offline run, which uses no network', async () => {
    const dir = project({ 'package-lock.json': ONE_PACKAGE })
    const result = await run(dir, ['--offline', '--json'], { HTTPS_PROXY: PROXY })
    assert.doesNotMatch(result.stderr, WARNING)
  })

  const honoured: [string, Record<string, string>, string[]][] = [
    ['NODE_USE_ENV_PROXY=1', { NODE_USE_ENV_PROXY: '1' }, []],
    ['--use-env-proxy', {}, ['--use-env-proxy']],
    ['--use-env-proxy in NODE_OPTIONS', { NODE_OPTIONS: '--use-env-proxy' }, []]
  ]
  for (const [label, env, nodeArgs] of honoured) {
    it(`does not warn when ${label} makes Node use the proxy`, async () => {
      await withRegistry(found, async url => {
        const dir = project({ 'package-lock.json': ONE_PACKAGE })
        const result = await run(
          dir,
          ['--json'],
          // NO_PROXY keeps the stand-in registry reachable without a real proxy.
          { HTTPS_PROXY: PROXY, NO_PROXY: '127.0.0.1', [REGISTRY_ENV]: url, ...env },
          nodeArgs
        )
        assert.strictEqual(result.code, 0, result.stderr)
        assert.doesNotMatch(result.stderr, WARNING)
      })
    })
  }
})

describe('registry stage', () => {
  it('counts lookups on a terminal and notes the cached ones on a later run', async () => {
    await withRegistry(found, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const env = { [REGISTRY_ENV]: url }
      const first = await run(dir, ['--json'], env, [TERMINAL])
      // ⠋ is each spinner's opening frame; ✔ is the line it leaves behind.
      for (const line of [
        /⠋\S* Parsing package-lock\.json\r/u,
        /✔\S* Parsed package-lock\.json \(1 packages\)\n/u,
        /⠋\S* Reading local packages\r/u,
        /✔\S* Reading local packages\n/u,
        /⠋\S* Fetching registry data\.\.\. 0\/1\r/u
      ]) {
        assert.match(first.stderr, line)
      }
      assert.match(first.stderr, /Fetching registry data\.\.\. 1\/1\n/u)
      assert.ok(!first.stderr.includes('cached'), first.stderr)

      const second = await run(dir, ['--json'], env, [TERMINAL])
      assert.match(second.stderr, /Fetching registry data\.\.\. 1\/1 \(1 cached\)\n/u)
    })
  })

  it('shows the running count while a slow lookup is still in flight', async () => {
    // p4 answers last, so the count stands at four while it is in flight.
    const slowLast: RequestListener = (req, res) => {
      setTimeout(() => res.end('{"version":"1.0.0"}'), String(req.url).includes('/p4') ? 250 : 0)
    }
    await withRegistry(slowLast, async url => {
      const packages = Object.fromEntries(
        [0, 1, 2, 3, 4].map(i => [`node_modules/p${i}`, { version: '1.0.0' }])
      )
      const dir = project({ 'package-lock.json': lockfile(packages) })
      const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url }, [TERMINAL])
      assert.strictEqual(result.code, 0, result.stderr)
      assert.match(result.stderr, /Fetching registry data\.\.\. 4\/5\r/u)
    })
  })

  it('still finishes the progress line when there is nothing to fetch', async () => {
    const dir = project({ 'package-lock.json': lockfile({}) })
    const result = await run(dir, ['--json'], {}, [TERMINAL])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.match(result.stderr, /Fetching registry data\.\.\. 0\/0\n/u)
  })

  it('closes the progress line and keeps fetched data when a lookup throws', async () => {
    await withRegistry(found, async url => {
      const packages = Object.fromEntries(
        [0, 1, 2, 3].map(i => [`node_modules/p${i}`, { version: '1.0.0' }])
      )
      // The fifth package starts only when a worker frees up, so one has been fetched.
      const dir = project({
        'package-lock.json': lockfile({
          ...packages,
          'node_modules/bad': { version: '1.0.0', name: 123 }
        })
      })
      const result = await run(dir, [], { [REGISTRY_ENV]: url }, [TERMINAL])
      assert.strictEqual(result.code, 1)
      assert.match(result.stderr, /✖\S* Fetching registry data\n/u)
      assert.match(result.stderr, /Error: /u)
      const saved = readFileSync(join(dir, '.cache/semver-ranger/versions.json'), 'utf8')
      assert.ok(`${url}|p0@1.0.0` in (JSON.parse(saved) as object), saved)
    })
  })

  // Regression: one non-string engines value made the cache drop the whole object,
  // so the run after the one that fetched it reported a wider safe range.
  it('reports the same range from a warm cache as from a cold one', async () => {
    const docs: Record<string, object> = {
      '/a/1.0.0': { version: '1.0.0', engines: { node: '>=14', npm: 7 } },
      '/b/1.0.0': { version: '1.0.0', engines: { node: '>=12' } }
    }
    const answer: RequestListener = (req, res) => {
      res.end(JSON.stringify(docs[String(req.url)] ?? { version: '1.0.0' }))
    }
    await withRegistry(answer, async url => {
      const dir = project({
        'package-lock.json': JSON.stringify({
          lockfileVersion: 1,
          dependencies: { a: { version: '1.0.0' }, b: { version: '1.0.0' } }
        })
      })
      const node = async () => {
        const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url })
        assert.strictEqual(result.code, 0, result.stderr)
        return parseJson(result.stdout).targets.find(target => target.name === 'node')
      }
      const cold = await node()
      assert.strictEqual(cold?.intersection, '>=14.0.0')
      assert.deepStrictEqual(await node(), cold)
    })
  })

  // Regression: the cache was written only when a run ended, so Ctrl-C threw away
  // every response fetched so far.
  it('saves the fetched data and exits 130 when interrupted', async () => {
    let served = 0
    let ready: () => void = () => {}
    const firstAnswered = new Promise<void>(resolve => {
      ready = resolve
    })
    // p0's two lookups are answered; every later request hangs.
    const answerFirst: RequestListener = (req, res) => {
      if (!String(req.url).startsWith('/p0/')) return
      res.end('{"version":"1.0.0"}')
      served += 1
      if (served === 2) ready()
    }
    await withRegistry(answerFirst, async url => {
      const packages = Object.fromEntries(
        [0, 1].map(i => [`node_modules/p${i}`, { version: '1.0.0' }])
      )
      const dir = project({ 'package-lock.json': lockfile(packages) })
      const child = execFile(process.execPath, ['--no-warnings', CLI, '--json'], {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          XDG_CACHE_HOME: join(dir, '.cache'),
          [USERCONFIG_ENV]: join(dir, 'no-such-npmrc'),
          [REGISTRY_ENV]: url
        }
      })
      const exited = new Promise<number | null>(resolve => child.on('exit', resolve))
      await firstAnswered
      // Let the child record p0's answer before interrupting it.
      await new Promise(resolve => setTimeout(resolve, 100))
      child.kill('SIGINT')
      assert.strictEqual(await exited, 130)
      const saved = readFileSync(join(dir, '.cache/semver-ranger/versions.json'), 'utf8')
      assert.ok(`${url}|p0@1.0.0` in (JSON.parse(saved) as object), saved)
    })
  })

  it('warns, without failing, when the cache cannot be saved', async () => {
    await withRegistry(found, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE, 'a-file': '' })
      const result = await run(dir, ['--json'], {
        [REGISTRY_ENV]: url,
        XDG_CACHE_HOME: join(dir, 'a-file')
      })
      assert.strictEqual(result.code, 0)
      assert.match(result.stderr, /Warning: could not persist the registry cache: .*ENOTDIR/u)
    })
  })

  // The breaker trips on the eighth stalled package; the three started beside it
  // still run, so 11 of 12 are looked up.
  it('stops at a stalled registry and says how much it skipped', async () => {
    const packages = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`node_modules/p${i}`, { version: '1.0.0' }])
    )
    const stalled = preload(
      "globalThis.fetch = () => Promise.reject(new DOMException('slow', 'TimeoutError'))"
    )
    const dir = project({ 'package-lock.json': lockfile(packages) })
    const result = await run(dir, ['--json'], {}, [stalled])
    assert.strictEqual(result.code, 0, result.stderr)
    assert.match(
      result.stderr,
      /so 1 package\(s\) were not looked up\. Re-run when it is reachable, or pass --offline\./u
    )
    assert.match(result.stderr, /22 registry lookup\(s\) failed/u)
    const { unresolved, skipped } = parseJson(result.stdout)
    assert.deepStrictEqual([unresolved.length, skipped], [22, 1])
  })

  it('does not mention skipped packages when the registry answered', async () => {
    await withRegistry(found, async url => {
      const dir = project({ 'package-lock.json': ONE_PACKAGE })
      const result = await run(dir, ['--json'], { [REGISTRY_ENV]: url })
      assert.ok(!result.stderr.includes('not looked up'), result.stderr)
    })
  })
})
