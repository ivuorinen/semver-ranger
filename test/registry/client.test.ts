import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

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
  it('resolveRegistry in offline mode skips all fetches', async () => {
    // In offline mode no fetches should happen
    // We test by importing with offline: true
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const packages = [{ name: 'express', version: '4.18.2' }]
    // Should complete without throwing even with no network
    const { packages: result } = await resolveRegistry(packages, { offline: true })
    assert.strictEqual(result.length, 1)
    assert.ok(typeof result[0].latestVersion === 'undefined')
  })

  it('resolveRegistry returns packages unchanged structure', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const packages = [{ name: 'nonexistent-xyz-pkg-12345', version: '1.0.0' }]
    // offline mode — safe to call
    const { packages: result } = await resolveRegistry(packages, { offline: true })
    assert.strictEqual(result[0].name, 'nonexistent-xyz-pkg-12345')
  })

  it('encodeName: scoped package URL encodes the slash', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const urls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input: string | URL | Request) => {
      urls.push(String(input))
      return { ok: false, json: async () => ({}) } as unknown as Response
    }
    try {
      await resolveRegistry([{ name: '@scope/pkg', version: '1.0.0' }], { offline: false })
      assert.ok(
        urls.some(u => u.includes('@scope%2Fpkg')),
        `expected encoded URL in: ${urls.join(', ')}`
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: cache miss + fetch ok → engines enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({ engines: { node: '>=18' }, peerDependencies: {} }, {})
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-ok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result[0].engines?.node, '>=18')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: fetch !ok → engines not enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-notok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchManifest: fetch throws → no crash, package returned unchanged', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-manifest-throw-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result.length, 1)
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchLatest: cache miss + fetch ok → latestVersion set', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({}, { version: '5.0.0', engines: { node: '>=20' } })
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-latest-ok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result[0].latestVersion, '5.0.0')
      assert.strictEqual(result[0].latestEngines?.node, '>=20')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fetchLatest: fetch !ok → latestVersion undefined', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-latest-notok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.ok(typeof result[0].latestVersion === 'undefined')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses cached manifest and latest data when both are cached', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.js')
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const name = `cached-${Date.now()}`
    setVersionData(`${name}@1.0.0`, { engines: { node: '>=18' }, peerDependencies: {} })
    setLatestData(name, { version: '2.0.0', engines: { node: '>=20' }, peerDependencies: {} })
    const { packages: result } = await resolveRegistry([{ name, version: '1.0.0' }], {
      offline: false
    })
    assert.strictEqual(result[0].engines?.node, '>=18')
    assert.strictEqual(result[0].latestVersion, '2.0.0')
  })

  it('fetchLatest: missing version in response → latestVersion undefined (Fix 6)', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeDualFetch({}, { engines: { node: '>=18' } })
    try {
      const { packages: result } = await resolveRegistry(
        [{ name: `test-fix6-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.ok(
        typeof result[0].latestVersion === 'undefined',
        'latestVersion should be undefined when version field is absent'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('offline mode enriches from cache instead of skipping (Fix 8)', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.js')
    const { resolveRegistry } = await import('../../src/registry/client.js')
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
      const { packages: result } = await resolveRegistry([{ name, version: '1.0.0' }], {
        offline: true
      })
      assert.strictEqual(fetchCalled, false, 'fetch must not be called in offline mode')
      assert.strictEqual(result[0].engines?.node, '>=16')
      assert.strictEqual(result[0].latestVersion, '3.0.0')
      assert.strictEqual(result[0].latestEngines?.node, '>=20')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('processBatch: >CONCURRENCY packages are all returned', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFailFetch()
    const ts = Date.now()
    const pkgs = Array.from({ length: 10 }, (_, i) => ({
      name: `test-batch-${i}-${ts}`,
      version: '1.0.0'
    }))
    try {
      const { packages: result } = await resolveRegistry(pkgs, { offline: false })
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
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const original = globalThis.fetch
    globalThis.fetch = makeFailFetch() as typeof globalThis.fetch
    try {
      const { failed } = await resolveRegistry([{ name: 'nope-pkg-xyz', version: '9.9.9' }], {
        offline: false
      })
      // one manifest lookup + one latest lookup
      assert.strictEqual(failed, 2)
    } finally {
      globalThis.fetch = original
    }
  })

  it('counts thrown requests as failed lookups', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof globalThis.fetch
    try {
      const { failed } = await resolveRegistry([{ name: 'throws-pkg-xyz', version: '9.9.9' }], {
        offline: false
      })
      assert.strictEqual(failed, 2)
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports zero failures in offline mode', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const { failed } = await resolveRegistry([{ name: 'anything', version: '1.0.0' }], {
      offline: true
    })
    assert.strictEqual(failed, 0)
  })
})

describe('registryFor', () => {
  const REGISTRY_ENV = 'npm_config_registry'
  const SCOPED_ENV = 'npm_config_@acme:registry'

  it('defaults to the public npm registry', async () => {
    const { registryFor } = await import('../../src/registry/client.js')
    delete process.env[REGISTRY_ENV]
    assert.strictEqual(registryFor('express'), 'https://registry.npmjs.org')
  })

  it('honours npm_config_registry and strips a trailing slash', async () => {
    const { registryFor } = await import('../../src/registry/client.js')
    process.env[REGISTRY_ENV] = 'https://npm.internal.example.com/'
    try {
      assert.strictEqual(registryFor('express'), 'https://npm.internal.example.com')
    } finally {
      delete process.env[REGISTRY_ENV]
    }
  })

  it('prefers a scope-specific registry for scoped packages', async () => {
    const { registryFor } = await import('../../src/registry/client.js')
    process.env[REGISTRY_ENV] = 'https://npm.internal.example.com'
    process.env[SCOPED_ENV] = 'https://acme.example.com'
    try {
      assert.strictEqual(registryFor('@acme/thing'), 'https://acme.example.com')
      assert.strictEqual(registryFor('express'), 'https://npm.internal.example.com')
    } finally {
      delete process.env[REGISTRY_ENV]
      delete process.env[SCOPED_ENV]
    }
  })
})
