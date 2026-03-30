import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('registry client', () => {
  it('resolveRegistry in offline mode skips all fetches', async () => {
    // In offline mode no fetches should happen
    // We test by importing with offline: true
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const packages = [{ name: 'express', version: '4.18.2' }]
    // Should complete without throwing even with no network
    const result = await resolveRegistry(packages, { offline: true })
    assert.strictEqual(result.length, 1)
    assert.ok(!result[0].latestVersion)
  })

  it('resolveRegistry returns packages unchanged structure', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const packages = [{ name: 'nonexistent-xyz-pkg-12345', version: '1.0.0' }]
    // offline mode — safe to call
    const result = await resolveRegistry(packages, { offline: true })
    assert.strictEqual(result[0].name, 'nonexistent-xyz-pkg-12345')
  })

  it('encodeName: scoped package URL encodes the slash', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const urls: string[] = []
    ;(globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request) => {
      urls.push(String(input))
      return { ok: false, json: async () => ({}) } as Response
    }
    try {
      await resolveRegistry([{ name: '@scope/pkg', version: '1.0.0' }], { offline: false })
      assert.ok(
        urls.some(u => u.includes('@scope%2Fpkg')),
        `expected encoded URL in: ${urls.join(', ')}`
      )
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('fetchManifest: cache miss + fetch ok → engines enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const manifestOkResponse: Response = {
      ok: true,
      json: async () => ({ engines: { node: '>=18' }, peerDependencies: {} })
    } as Response
    ;(globalThis as Record<string, unknown>).fetch = async () => manifestOkResponse
    try {
      const result = await resolveRegistry(
        [{ name: `test-manifest-ok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result[0].engines?.node, '>=18')
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('fetchManifest: fetch !ok → engines not enriched', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
    try {
      const result = await resolveRegistry(
        [{ name: `test-manifest-notok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('fetchManifest: fetch throws → no crash, package returned unchanged', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    try {
      const result = await resolveRegistry(
        [{ name: `test-manifest-throw-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result.length, 1)
      assert.ok(typeof result[0].engines === 'undefined')
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('fetchLatest: cache miss + fetch ok → latestVersion set', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    ;(globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/latest')) {
        return {
          ok: true,
          json: async () => ({ version: '5.0.0', engines: { node: '>=20' } })
        } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    }
    try {
      const result = await resolveRegistry(
        [{ name: `test-latest-ok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.strictEqual(result[0].latestVersion, '5.0.0')
      assert.strictEqual(result[0].latestEngines?.node, '>=20')
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('fetchLatest: fetch !ok → latestVersion undefined', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
    try {
      const result = await resolveRegistry(
        [{ name: `test-latest-notok-${Date.now()}`, version: '1.0.0' }],
        { offline: false }
      )
      assert.ok(typeof result[0].latestVersion === 'undefined')
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })

  it('uses cached manifest and latest data when both are cached', async () => {
    const { setVersionData, setLatestData } = await import('../../src/cache/index.js')
    const { resolveRegistry } = await import('../../src/registry/client.js')
    const name = `cached-${Date.now()}`
    setVersionData(`${name}@1.0.0`, { engines: { node: '>=18' }, peerDependencies: {} })
    setLatestData(name, { version: '2.0.0', engines: { node: '>=20' }, peerDependencies: {} })
    const result = await resolveRegistry([{ name, version: '1.0.0' }], { offline: false })
    assert.strictEqual(result[0].engines?.node, '>=18')
    assert.strictEqual(result[0].latestVersion, '2.0.0')
  })

  it('processBatch: >CONCURRENCY packages are all returned', async () => {
    const { resolveRegistry } = await import('../../src/registry/client.js')
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
    const ts = Date.now()
    const pkgs = Array.from({ length: 10 }, (_, i) => ({
      name: `test-batch-${i}-${ts}`,
      version: '1.0.0'
    }))
    try {
      const result = await resolveRegistry(pkgs, { offline: false })
      assert.strictEqual(result.length, 10)
    } finally {
      delete (globalThis as Record<string, unknown>).fetch
    }
  })
})
