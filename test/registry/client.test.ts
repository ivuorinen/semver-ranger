import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it, mock } from 'node:test'

// Keep the developer's npm configuration, registry cache and any project .npmrc
// out of these tests. npm reads its variables in any case, and sets some itself
// when it runs the test script.
const USERCONFIG_ENV = 'npm_config_userconfig'
for (const name of Object.keys(process.env)) {
  if (name.toLowerCase().startsWith('npm_config_')) delete process.env[name]
}
process.env[USERCONFIG_ENV] = '/nonexistent/.npmrc'
const cacheRoot = mkdtempSync(join(tmpdir(), 'semver-ranger-client-'))
process.env.XDG_CACHE_HOME = cacheRoot
// The cache directory holds no .npmrc, so it doubles as a bare project.
const online = { offline: false, projectDir: cacheRoot }
const offline = { offline: true, projectDir: cacheRoot }

after(() => {
  rmSync(cacheRoot, { recursive: true, force: true })
})

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Formats failures as the CLI's warning does, so expectations stay exact and
 * readable while each field still has to be right for a label to match.
 * @param {{name: string, version: string, reason: string}[]} failures Failures to format.
 * @returns {string[]} One `name@version (reason)` per failure.
 */
function labels(failures: { name: string; version: string; reason: string }[]): string[] {
  return failures.map(({ name, version, reason }) => `${name}@${version} (${reason})`)
}

/**
 * Returns a mock fetch that serves `manifest` for version requests
 * and `latest` for /latest requests.
 * @param {Record<string, unknown>} manifest Data served for version requests.
 * @param {Record<string, unknown>} latest Data served for /latest requests.
 * @returns {FetchFn} Mock fetch function.
 */
function makeDualFetch(
  manifest: Record<string, unknown>,
  latest: Record<string, unknown>
): FetchFn {
  return async input => {
    const url = String(input)
    if (url.includes('/latest')) {
      return { ok: true, json: async () => latest } as unknown as Response
    }
    return { ok: true, json: async () => manifest } as unknown as Response
  }
}

/**
 * Returns a mock fetch that always fails (ok: false).
 * @returns {FetchFn} Mock fetch function that always returns ok: false.
 */
function makeFailFetch(): FetchFn {
  return async () => ({ ok: false, json: async () => ({}) }) as unknown as Response
}

describe('registry client', () => {
  it('offline mode with an empty cache returns packages unchanged, without fetching', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const packages = [{ name: 'express', version: '4.18.2' }]
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      calls += 1
      return { ok: false, json: async () => ({}) } as unknown as Response
    }
    try {
      const { packages: result, latestUncached } = await resolveRegistry(packages, offline)
      assert.deepStrictEqual(result, packages)
      assert.strictEqual(calls, 0)
      assert.deepStrictEqual(latestUncached, packages)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('encodeName: scoped package URL encodes the slash', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const urls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: string | URL | Request) => {
      urls.push(String(input))
      return { ok: false, json: async () => ({}) } as unknown as Response
    }
    try {
      await resolveRegistry([{ name: '@scope/pkg', version: '1.0.0' }], online)
      assert.ok(
        urls.some(u => u.includes('@scope%2Fpkg')),
        `expected encoded URL in: ${urls.join(', ')}`
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: cache miss + fetch ok → engines enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({ engines: { node: '>=18' }, peerDependencies: {} }, {})
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-ok-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.strictEqual(result[0].engines?.node, '>=18')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: fetch !ok → engines not enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-notok-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: fetch throws → no crash, package returned unchanged', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-throw-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.strictEqual(result.length, 1)
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchLatest: cache miss + fetch ok → latest set', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({}, { version: '5.0.0', engines: { node: '>=20' } })
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-latest-ok-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.strictEqual(result[0].latest?.version, '5.0.0')
      assert.strictEqual(result[0].latest?.engines?.node, '>=20')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchLatest: fetch !ok → latest undefined', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-latest-notok-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.ok(typeof result[0].latest === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses cached manifest and latest data when both are cached', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.ts')
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const name = `cached-${Date.now()}`
    setVersionData(`${name}@1.0.0`, { engines: { node: '>=18' }, peerDependencies: {} })
    setLatestData(name, { version: '2.0.0', engines: { node: '>=20' }, peerDependencies: {} })
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      calls += 1
      return { ok: false, json: async () => ({}) } as unknown as Response
    }
    try {
      const { packages: result } = await resolveRegistry([{ name, version: '1.0.0' }], online)
      assert.strictEqual(result[0].engines?.node, '>=18')
      assert.strictEqual(result[0].latest?.version, '2.0.0')
      assert.strictEqual(calls, 0, 'a cached lookup must not reach the network')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchLatest: missing version in response → latest undefined (Fix 6)', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({}, { engines: { node: '>=18' } })
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-fix6-${Date.now()}`, version: '1.0.0' }],
        online
      )
      assert.ok(
        typeof result[0].latest === 'undefined',
        'latest should be undefined when version field is absent'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // Regression: --offline skipped the cache, so cached constraints went unused.
  it('offline mode enriches from cache instead of skipping', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.ts')
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const name = `offline-cache-${Date.now()}`
    setVersionData(`${name}@1.0.0`, {
      engines: { node: '>=16' },
      peerDependencies: { react: '>=17' }
    })
    setLatestData(name, {
      version: '3.0.0',
      engines: { node: '>=20' },
      peerDependencies: { react: '>=18' }
    })

    let fetchCalled = false
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      fetchCalled = true
      return { ok: true, json: async () => ({}) } as unknown as Response
    }
    try {
      const { packages: result, failures } = await resolveRegistry(
        [{ name, version: '1.0.0' }],
        offline
      )
      assert.strictEqual(fetchCalled, false, 'fetch must not be called in offline mode')
      assert.strictEqual(result[0].engines?.node, '>=16')
      assert.deepStrictEqual(result[0].peerDependencies, { react: '>=17' })
      assert.deepStrictEqual(result[0].latest, {
        version: '3.0.0',
        engines: { node: '>=20' },
        peerDependencies: { react: '>=18' }
      })
      assert.deepStrictEqual(failures, [], 'a cached manifest vouches for the package')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('processBatch: >CONCURRENCY packages are all returned', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    const ts = Date.now()
    const pkgs = Array.from({ length: 10 }, (_, i) => ({
      name: `test-batch-${i}-${ts}`,
      version: '1.0.0'
    }))
    try {
      const { packages: result } = await resolveRegistry(pkgs, online)
      assert.strictEqual(result.length, 10)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('registry failure reporting', () => {
  // Regression: every failure returned null and was discarded, so a run with no
  // usable registry data still rendered a clean, over-permissive table.
  it('counts non-ok responses as failed lookups', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const original = globalThis.fetch
    globalThis.fetch = makeFailFetch() as typeof globalThis.fetch
    try {
      const { failures } = await resolveRegistry(
        [{ name: 'nope-pkg-xyz', version: '9.9.9' }],
        online
      )
      // one manifest lookup + one latest lookup
      assert.strictEqual(failures.length, 2)
    } finally {
      globalThis.fetch = original
    }
  })

  it('counts thrown requests as failed lookups', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof globalThis.fetch
    try {
      const { failures } = await resolveRegistry(
        [{ name: 'throws-pkg-xyz', version: '9.9.9' }],
        online
      )
      assert.strictEqual(failures.length, 2)
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports zero failures offline when the lockfile vouches for a package', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const { failures } = await resolveRegistry(
      [{ name: 'anything', version: '1.0.0', hasMetadata: true }],
      offline
    )
    assert.deepStrictEqual(failures, [])
  })

  // Regression: an unresolved package silently widened the range under --offline.
  it('reports a package nothing can vouch for offline', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const { failures } = await resolveRegistry([{ name: 'anything', version: '1.0.0' }], offline)
    assert.deepStrictEqual(labels(failures), ['anything@1.0.0 (no metadata)'])
  })

  // Regression: offline applied a public package's cache entries to a workspace
  // member of the same name and version, and invented a latest release for it.
  it('leaves unpublished packages alone offline despite colliding cache entries', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.ts')
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const name = `utils-${Date.now()}`
    setVersionData(`${name}@1.0.0`, { engines: { node: '>=0.8' } })
    setLatestData(name, { version: '9.9.9', engines: { node: '>=4' } })
    const member = {
      name,
      version: '1.0.0',
      unpublished: true,
      hasMetadata: true,
      engines: { node: '>=20' }
    }
    const fromGit = { name: `git-${name}`, version: '1.0.0', unpublished: true }
    const result = await resolveRegistry([member, fromGit], offline)
    assert.deepStrictEqual(result.packages, [member, fromGit])
    assert.deepStrictEqual(labels(result.failures), [`git-${name}@1.0.0 (not from a registry)`])
    assert.deepStrictEqual(result.latestUncached, [], 'no latest release exists to be cached')
  })

  it('names each failed lookup with its reason', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const original = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    try {
      const { failures } = await resolveRegistry([{ name: 'named-pkg', version: '1.0.0' }], online)
      assert.deepStrictEqual(labels(failures).toSorted(), [
        'named-pkg@1.0.0 (HTTP 404)',
        'named-pkg@latest (HTTP 404)'
      ])
    } finally {
      globalThis.fetch = original
    }
  })

  // Regression: failures were `name@version (reason)` strings, so a reader had to
  // split them on an `@` that scoped names also hold.
  it('reports a failure as separate name, version and reason fields', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const original = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    const name = `@scope/fields-${Date.now()}`
    try {
      const { failures } = await resolveRegistry([{ name, version: '1.0.0' }], online)
      assert.deepStrictEqual(
        failures.toSorted((a, b) => a.version.localeCompare(b.version)),
        [
          { name, version: '1.0.0', reason: 'HTTP 404' },
          { name, version: 'latest', reason: 'HTTP 404' }
        ]
      )
    } finally {
      globalThis.fetch = original
    }
  })

  const reasons: [string, () => Promise<unknown>, string[]][] = [
    [
      'a network error',
      async () => {
        throw new Error('ECONNRESET')
      },
      ['1.0.0 (network error: ECONNRESET)', 'latest (network error: ECONNRESET)']
    ],
    [
      'a timeout',
      async () => {
        throw new DOMException('slow', 'TimeoutError')
      },
      ['1.0.0 (timeout)', 'latest (timeout)']
    ],
    [
      'a response that is not an object',
      async () => ({ ok: true, json: async () => [] }),
      ['1.0.0 (malformed response)', 'latest (malformed response)']
    ],
    [
      'a null response',
      async () => ({ ok: true, json: async () => null }),
      ['1.0.0 (malformed response)', 'latest (malformed response)']
    ],
    [
      'a numeric response',
      async () => ({ ok: true, json: async () => 1 }),
      ['1.0.0 (malformed response)', 'latest (malformed response)']
    ],
    [
      'a latest document with no version',
      async () => ({ ok: true, json: async () => ({}) }),
      ['latest (no version in response)']
    ],
    [
      'a latest document with an empty version',
      async () => ({ ok: true, json: async () => ({ version: '' }) }),
      ['latest (no version in response)']
    ]
  ]
  for (const [index, [label, fetchMock, expected]] of reasons.entries()) {
    it(`reports ${label} with its reason`, async () => {
      const { resolveRegistry } = await import('../../src/registry/client.ts')
      const original = globalThis.fetch
      globalThis.fetch = fetchMock as unknown as typeof fetch
      // A successful lookup is cached, so each case needs a package of its own.
      const name = `reason-${index}`
      try {
        const { failures } = await resolveRegistry([{ name, version: '1.0.0' }], online)
        assert.deepStrictEqual(
          labels(failures).toSorted(),
          expected.map(reason => `${name}@${reason}`)
        )
      } finally {
        globalThis.fetch = original
      }
    })
  }

  // Regression: both read "network error", so a user could not tell a proxy's
  // login page from a registry that is down.
  it('tells an HTML page from a refused connection', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const project = mkdtempSync(join(tmpdir(), 'semver-ranger-reasons-'))
    const portal = createServer((_request, response) => response.end('<html>Sign in</html>'))
    const down = createServer()
    portal.listen(0, '127.0.0.1')
    down.listen(0, '127.0.0.1')
    await Promise.all([once(portal, 'listening'), once(down, 'listening')])
    const portOf = (server: Server) => (server.address() as AddressInfo).port
    writeFileSync(
      join(project, '.npmrc'),
      `@portal:registry=http://127.0.0.1:${portOf(portal)}/\n` +
        `@down:registry=http://127.0.0.1:${portOf(down)}/\n`
    )
    down.close()
    await once(down, 'close')
    try {
      const { failures } = await resolveRegistry(
        [
          { name: '@portal/a', version: '1.0.0' },
          { name: '@down/a', version: '1.0.0' }
        ],
        { offline: false, projectDir: project }
      )
      assert.deepStrictEqual(labels(failures).toSorted(), [
        '@down/a@1.0.0 (network error: ECONNREFUSED)',
        '@down/a@latest (network error: ECONNREFUSED)',
        '@portal/a@1.0.0 (malformed response)',
        '@portal/a@latest (malformed response)'
      ])
    } finally {
      portal.close()
      rmSync(project, { recursive: true, force: true })
    }
  })
})

describe('registryFor', () => {
  const REGISTRY_ENV = 'npm_config_registry'

  it('defaults to the public npm registry', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    delete process.env[REGISTRY_ENV]
    assert.strictEqual(registryFor('express', new Map()), 'https://registry.npmjs.org')
  })

  it('honours npm_config_registry and strips trailing slashes', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    process.env[REGISTRY_ENV] = 'https://npm.internal.example.com//'
    try {
      assert.strictEqual(registryFor('express', new Map()), 'https://npm.internal.example.com')
    } finally {
      delete process.env[REGISTRY_ENV]
    }
  })

  it('treats an empty npm_config_registry as unset', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    process.env[REGISTRY_ENV] = ''
    const registries = new Map([['registry', 'https://mirror.example.com']])
    try {
      assert.strictEqual(registryFor('express', registries), 'https://mirror.example.com')
    } finally {
      delete process.env[REGISTRY_ENV]
    }
  })

  // npm matches these variables in any case; only lower case used to be read.
  for (const variable of ['NPM_CONFIG_REGISTRY', 'Npm_Config_Registry']) {
    it(`honours ${variable}`, async () => {
      const { registryFor } = await import('../../src/registry/client.ts')
      process.env[variable] = 'https://upper.example.com'
      try {
        assert.strictEqual(registryFor('express', new Map()), 'https://upper.example.com')
      } finally {
        delete process.env[variable]
      }
    })
  }

  it('is not masked by an empty variable in another case', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    process.env.NPM_CONFIG_REGISTRY = 'https://upper.example.com'
    process.env[REGISTRY_ENV] = ''
    try {
      assert.strictEqual(registryFor('express', new Map()), 'https://upper.example.com')
    } finally {
      delete process.env.NPM_CONFIG_REGISTRY
      delete process.env[REGISTRY_ENV]
    }
  })

  // Two spellings of one variable can both be set on POSIX; npm keeps the last.
  it('lets the last of two spellings win', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    process.env.NPM_CONFIG_REGISTRY = 'https://first.example.com'
    process.env[REGISTRY_ENV] = 'https://last.example.com'
    try {
      assert.strictEqual(registryFor('express', new Map()), 'https://last.example.com')
    } finally {
      delete process.env.NPM_CONFIG_REGISTRY
      delete process.env[REGISTRY_ENV]
    }
  })

  it('prefers a scope-specific registry for scoped packages', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    process.env[REGISTRY_ENV] = 'https://npm.internal.example.com'
    const registries = new Map([['@acme:registry', 'https://acme.example.com']])
    try {
      assert.strictEqual(registryFor('@acme/thing', registries), 'https://acme.example.com')
      assert.strictEqual(registryFor('express', registries), 'https://npm.internal.example.com')
    } finally {
      delete process.env[REGISTRY_ENV]
    }
  })
})

describe('.npmrc registries', () => {
  const root = mkdtempSync(join(tmpdir(), 'semver-ranger-npmrc-'))

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads scope and default settings, with the project over the user', async () => {
    const { readRegistries } = await import('../../src/registry/client.ts')
    const user = join(root, 'user-npmrc')
    writeFileSync(user, 'registry=https://user.example.com/\n@a:registry=https://a.example.com/\n')
    writeFileSync(
      join(root, '.npmrc'),
      [
        'registry = "https://project.example.com/"',
        ';registry=https://off.example.com/',
        '#registry=https://off.example.com/'
      ].join('\n')
    )
    process.env[USERCONFIG_ENV] = user
    try {
      const found = readRegistries(root)
      assert.strictEqual(found.get('registry'), 'https://project.example.com/')
      assert.strictEqual(found.get('@a:registry'), 'https://a.example.com/')
    } finally {
      process.env[USERCONFIG_ENV] = '/nonexistent/.npmrc'
    }
  })

  it('honours NPM_CONFIG_USERCONFIG', async () => {
    const { readRegistries } = await import('../../src/registry/client.ts')
    const user = join(root, 'upper-npmrc')
    writeFileSync(user, 'registry=https://upper-user.example.com/\n')
    delete process.env[USERCONFIG_ENV]
    process.env.NPM_CONFIG_USERCONFIG = user
    try {
      const found = readRegistries(join(root, 'no-project-npmrc'))
      assert.strictEqual(found.get('registry'), 'https://upper-user.example.com/')
    } finally {
      delete process.env.NPM_CONFIG_USERCONFIG
      process.env[USERCONFIG_ENV] = '/nonexistent/.npmrc'
    }
  })

  it('falls back to ~/.npmrc when the user configuration variable is empty', async () => {
    const { readRegistries } = await import('../../src/registry/client.ts')
    const home = join(root, 'empty-userconfig-home')
    mkdirSync(home)
    writeFileSync(join(home, '.npmrc'), 'registry=https://home.example.com/\n')
    const originalHome = process.env.HOME
    process.env[USERCONFIG_ENV] = ''
    process.env.HOME = home
    try {
      const found = readRegistries(join(root, 'no-project-npmrc'))
      assert.strictEqual(found.get('registry'), 'https://home.example.com/')
    } finally {
      process.env.HOME = originalHome
      process.env[USERCONFIG_ENV] = '/nonexistent/.npmrc'
    }
  })

  it('reads ~/.npmrc when npm names no other user configuration', async () => {
    const { readRegistries } = await import('../../src/registry/client.ts')
    const home = join(root, 'home')
    mkdirSync(home)
    writeFileSync(join(home, '.npmrc'), 'registry=https://home.example.com/\n')
    const originalHome = process.env.HOME
    delete process.env[USERCONFIG_ENV]
    process.env.HOME = home
    try {
      const found = readRegistries(join(root, 'no-project-npmrc'))
      assert.strictEqual(found.get('registry'), 'https://home.example.com/')
    } finally {
      process.env.HOME = originalHome
      process.env[USERCONFIG_ENV] = '/nonexistent/.npmrc'
    }
  })

  it('uses the default registry from .npmrc when the environment has none', async () => {
    const { registryFor } = await import('../../src/registry/client.ts')
    const registries = new Map([['registry', 'https://mirror.example.com/']])
    assert.strictEqual(registryFor('express', registries), 'https://mirror.example.com')
  })

  // Regression: an unreadable file was skipped like a missing one, so the private
  // scope it named was looked up on the default registry.
  it(
    'fails before any request on a .npmrc it cannot read',
    // Root reads a mode 000 file anyway, and Windows has no getuid or mode bits.
    { skip: (process.getuid?.() ?? 0) === 0 && 'needs a non-root POSIX user' },
    async () => {
      const { resolveRegistry } = await import('../../src/registry/client.ts')
      const dir = join(root, 'unreadable')
      mkdirSync(dir)
      const npmrc = join(dir, '.npmrc')
      writeFileSync(npmrc, '@corp:registry=https://private.example.com/\n')
      chmodSync(npmrc, 0o000)
      let calls = 0
      const original = globalThis.fetch
      globalThis.fetch = (async () => {
        calls += 1
        return { ok: false, status: 404 }
      }) as unknown as typeof fetch
      try {
        await assert.rejects(
          resolveRegistry([{ name: '@corp/secret-tool', version: '1.0.0' }], {
            offline: false,
            projectDir: dir
          }),
          { message: `cannot read ${npmrc}: EACCES: permission denied, open '${npmrc}'` }
        )
        assert.strictEqual(calls, 0)
      } finally {
        globalThis.fetch = original
      }
    }
  )

  it('does not serve one registry the cached answer of another', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const { setVersionData, flushCache } = await import('../../src/cache/index.ts')
    const name = `@prefixed/pkg-${Date.now()}`
    setVersionData(`${name}@1.0.0`, { engines: { node: '>=1' } })
    flushCache()
    const dir = join(root, 'scoped')
    mkdirSync(dir)
    writeFileSync(join(dir, '.npmrc'), '@prefixed:registry=https://private.example.com/\n')

    const urls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input))
      return { ok: true, json: async () => ({ version: '1.0.0', engines: { node: '>=2' } }) }
    }) as unknown as typeof fetch
    try {
      const { packages } = await resolveRegistry([{ name, version: '1.0.0' }], {
        offline: false,
        projectDir: dir
      })
      assert.strictEqual(packages[0].engines?.node, '>=2')
      assert.ok(urls.every(url => url.startsWith('https://private.example.com/')))
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('registry requests', () => {
  /**
   * Replaces fetch for one call, restoring it afterwards.
   * @param {typeof fetch} replacement The mock to install.
   * @param {Function} body The work to do while it is installed.
   * @returns {Promise<void>} Resolves when the body has finished.
   */
  async function withFetch(replacement: unknown, body: () => Promise<void>): Promise<void> {
    const original = globalThis.fetch
    globalThis.fetch = replacement as typeof fetch
    try {
      await body()
    } finally {
      globalThis.fetch = original
    }
  }

  const stamp = Date.now()
  const pkgs = (label: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({ name: `${label}-${stamp}-${i}`, version: '1.0.0' }))
  const timeout = async () => {
    throw new DOMException('timed out', 'TimeoutError')
  }

  // Regression: nothing stopped at a stalled registry, at 10 s per round.
  // The breaker trips on the eighth stalled package in a row; the three packages
  // other workers had started by then still run, so 11 of 40 are looked up.
  it('stops after consecutive packages whose every request timed out', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    let calls = 0
    const stall = pkgs('stall', 40)
    await withFetch(
      async () => {
        calls += 1
        return await timeout()
      },
      async () => {
        const result = await resolveRegistry(stall, online)
        assert.strictEqual(calls, 22)
        assert.strictEqual(result.packages.length, 40)
        assert.deepStrictEqual(result.skipped, stall.slice(11))
      }
    )
  })

  // Regression: the breaker expected two requests per package, so once the version
  // lookups were cached only /latest went out and no batch ever counted as stalled.
  it('stops at a stalled registry when the version lookups are cached', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const { setVersionData } = await import('../../src/cache/index.ts')
    const warm = pkgs('warm-stall', 40)
    for (const { name } of warm) setVersionData(`${name}@1.0.0`, {})
    let calls = 0
    await withFetch(
      async () => {
        calls += 1
        return await timeout()
      },
      async () => {
        const result = await resolveRegistry(warm, online)
        assert.strictEqual(calls, 11)
        assert.deepStrictEqual(result.skipped, warm.slice(11))
      }
    )
  })

  it('counts only consecutive stalled packages', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    // Seven packages time out, one answers, seven more time out: fourteen stalled,
    // never eight in a row.
    const interrupted = async (input: unknown) => {
      const index = Number(/-(\d+)\//u.exec(String(input))?.[1])
      return index % 8 === 7 ? { ok: false, status: 404 } : await timeout()
    }
    await withFetch(interrupted, async () => {
      const result = await resolveRegistry(pkgs('interrupted', 16), online)
      assert.strictEqual(result.failures.length, 32)
      assert.deepStrictEqual(result.skipped, [])
    })
  })

  it('does not count a package whose requests only partly time out', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    // Every /latest times out, every version lookup answers.
    const partial = async (input: unknown) =>
      String(input).endsWith('/latest') ? await timeout() : { ok: false, status: 404 }
    await withFetch(partial, async () => {
      const result = await resolveRegistry(pkgs('partial', 12), online)
      assert.strictEqual(result.failures.length, 24)
      assert.deepStrictEqual(result.skipped, [])
    })
  })

  it('keeps going when requests fail for a reason other than a timeout', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    await withFetch(makeFailFetch(), async () => {
      const result = await resolveRegistry(pkgs('fail', 20), online)
      assert.deepStrictEqual(result.skipped, [])
      assert.strictEqual(result.failures.length, 40)
    })
  })

  it('does not treat a network error as a stalled registry', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const reset = async () => {
      throw new Error('ECONNRESET')
    }
    await withFetch(reset, async () => {
      const result = await resolveRegistry(pkgs('reset', 20), online)
      assert.deepStrictEqual(result.skipped, [])
      assert.strictEqual(result.failures.length, 40)
    })
  })

  it('reports progress once per package', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const calls: number[][] = []
    await withFetch(makeFailFetch(), async () => {
      await resolveRegistry(pkgs('progress', 8), {
        ...online,
        onProgress: (...args) => calls.push(args)
      })
    })
    assert.deepStrictEqual(
      calls,
      [1, 2, 3, 4, 5, 6, 7, 8].map(completed => [completed, 8, 0])
    )
  })

  // Regression: lookups ran in lockstep batches of four, so one slow response held
  // back the next package until the whole batch finished.
  it('starts the next package while a slow one is still in flight', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const events: string[] = []
    const slowFirst = async (input: unknown) => {
      const url = String(input)
      const index = Number(/-(\d+)\//u.exec(url)?.[1])
      if (!url.endsWith('/latest')) events.push(`start ${index}`)
      if (index === 0) {
        await new Promise(resolve => setTimeout(resolve, 50))
        events.push('slow done')
      }
      return { ok: false, status: 404 }
    }
    await withFetch(slowFirst, async () => {
      await resolveRegistry(pkgs('pool', 5), online)
    })
    assert.ok(events.indexOf('start 4') < events.indexOf('slow done'), events.join(', '))
  })

  // A thrown lookup is a bug, not a failed request: it ends the run, and the other
  // workers stop taking packages instead of fetching on in the background.
  it('stops handing out packages when a lookup throws', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const fetched: string[] = []
    const record = async (input: unknown) => {
      fetched.push(String(input))
      return { ok: false, status: 404 }
    }
    const [broken, ...rest] = pkgs('throws', 6)
    await withFetch(record, async () => {
      await assert.rejects(
        resolveRegistry([{ ...broken, name: 123 as never }, ...rest], online),
        TypeError
      )
    })
    // The three packages started beside the broken one finish; none after them start.
    assert.deepStrictEqual(
      [...new Set(fetched.map(url => /throws-\d+-(\d+)/u.exec(url)?.[1]))].toSorted(),
      ['1', '2', '3']
    )
  })

  // Regression: every cache hit counted, beside a package count, so a warm run
  // showed `5/5 (10 cached)`.
  it('counts a package as cached only when neither lookup needs a request', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const { setVersionData, setLatestData } = await import('../../src/cache/index.ts')
    const [warm, half] = pkgs('cached-count', 2)
    setVersionData(`${warm.name}@1.0.0`, {})
    setVersionData(`${half.name}@1.0.0`, {})
    setLatestData(warm.name, { version: '1.0.0' })
    const calls: number[][] = []
    await withFetch(makeFailFetch(), async () => {
      await resolveRegistry([warm, half], {
        ...online,
        onProgress: (...args) => calls.push(args)
      })
    })
    // The warm package finishes first and is the only one counted as cached.
    assert.deepStrictEqual(calls, [
      [1, 2, 1],
      [2, 2, 1]
    ])
  })

  // Regression: versions of one package, adjacent in yarn and pnpm lockfiles, each
  // requested /latest and each reported the same failure.
  it('requests /latest once for several versions of one package', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const [{ name }] = pkgs('versions', 1)
    // Five is more than the workers, so a version started later must not ask again either.
    const versions = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']
    const urls: string[] = []
    await withFetch(
      async (input: unknown) => {
        urls.push(String(input))
        return { ok: false, status: 404 }
      },
      async () => {
        const { failures } = await resolveRegistry(
          versions.map(version => ({ name, version })),
          online
        )
        assert.deepStrictEqual(labels(failures).toSorted(), [
          ...versions.map(version => `${name}@${version} (HTTP 404)`),
          `${name}@latest (HTTP 404)`
        ])
      }
    )
    assert.strictEqual(urls.filter(url => url.endsWith('/latest')).length, 1)
  })

  it('sets a ten-second timeout on every request', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const signals: unknown[] = []
    const spy = mock.method(AbortSignal, 'timeout')
    try {
      await withFetch(
        async (_input: unknown, init?: RequestInit) => {
          signals.push(init?.signal)
          return { ok: false, status: 404 }
        },
        async () => {
          await resolveRegistry(pkgs('signal', 1), online)
        }
      )
      assert.deepStrictEqual(
        spy.mock.calls.map(call => call.arguments),
        [[10_000], [10_000]]
      )
      const created = new Set<unknown>(spy.mock.calls.map(call => call.result))
      assert.strictEqual(signals.length, 2)
      assert.ok(signals.every(signal => created.has(signal)))
    } finally {
      spy.mock.restore()
    }
  })

  it('does not look up a workspace member', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    let calls = 0
    await withFetch(
      async () => {
        calls += 1
        return { ok: false, status: 404 }
      },
      async () => {
        const member = { name: '@me/a', version: '1.0.0', unpublished: true, hasMetadata: true }
        const { failures, packages } = await resolveRegistry([member], online)
        assert.strictEqual(calls, 0)
        assert.deepStrictEqual(failures, [])
        assert.deepStrictEqual(packages, [member])
      }
    )
  })

  // Regression: a git package's name was sent to the public registry, which could
  // also answer with an unrelated package of the same name.
  it('reports an unpublished package with no metadata without looking it up', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    let calls = 0
    await withFetch(
      async () => {
        calls += 1
        return { ok: false, status: 404 }
      },
      async () => {
        const fromGit = { name: 'private-thing', version: '1.0.0', unpublished: true }
        const { failures, packages } = await resolveRegistry([fromGit], online)
        assert.strictEqual(calls, 0)
        assert.deepStrictEqual(labels(failures), ['private-thing@1.0.0 (not from a registry)'])
        assert.deepStrictEqual(packages, [fromGit])
      }
    )
  })

  it('prefers registry data over lockfile data', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    await withFetch(
      makeDualFetch(
        { engines: { node: '>=20' }, peerDependencies: { a: '^2' } },
        { version: '1.0.0' }
      ),
      async () => {
        const [pkg] = pkgs('precedence', 1)
        const { packages } = await resolveRegistry(
          [{ ...pkg, engines: { node: '>=10' }, peerDependencies: { a: '^1' } }],
          online
        )
        assert.strictEqual(packages[0].engines?.node, '>=20')
        assert.deepStrictEqual(packages[0].peerDependencies, { a: '^2' })
      }
    )
  })

  it('encodes lockfile values placed in the URL', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.ts')
    const urls: string[] = []
    await withFetch(
      async (input: unknown) => {
        urls.push(String(input))
        return { ok: false, status: 404 }
      },
      async () => {
        await resolveRegistry([{ name: '@a/b/../c', version: '../../x?y=1' }], online)
      }
    )
    assert.ok(
      urls.some(url => url.endsWith('/@a%2Fb%2F..%2Fc/..%2F..%2Fx%3Fy%3D1')),
      urls.join()
    )
  })
})
