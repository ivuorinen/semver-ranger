# Test Coverage Gap Filling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise branch and line coverage across all source files by adding ~20 targeted tests to existing test files.

**Architecture:** Every change is additive — new `it()` blocks appended to existing `describe()` groups, no new test files. Fetch mocking uses `globalThis.fetch` reassignment (Node.js built-in, no extra deps). No source files are modified.

**Tech Stack:** Node.js built-in test runner (`node:test`), `node:assert/strict`, TypeScript, existing project fixtures in `test/fixtures/`.

---

## File Map

```
Modified test files only — no source changes, no new test files:
  test/registry/client.test.ts       ← 7 new tests (globalThis.fetch mock)
  test/graph/index.test.ts           ← 3 new tests (npm v1, yarn-classic, yarn-berry)
  test/output/table.test.ts          ← 1 new test (latestConflicts block)
  test/analyzer/engines.test.ts      ← 1 new test (wildcard '*' range)
  test/analyzer/peers.test.ts        ← 1 new test (latestPeerDependencies path)
  test/analyzer/intersect.test.ts    ← 1 new test (null minVersion sort branch)
  test/cache/index.test.ts           ← 1 new test (non-XDG getCacheDir path)
  test/parsers/npm.test.ts           ← 1 new test (v1 lockfile branch)
  test/parsers/pnpm.test.ts          ← 2 new tests (no-engines branch, peerDeps branch)
  test/parsers/yarn-classic.test.ts  ← 1 new test (parse failure branch)
  test/parsers/yarn-berry.test.ts    ← 1 new test (no-version entry branch)
```

---

## Task 1: Registry client — fetch mocking

**File:** `test/registry/client.test.ts`

The existing two tests only call `resolveRegistry({ offline: true })`, which short-circuits before any fetch. This task adds 7 tests that mock `globalThis.fetch` to cover `encodeName`, `fetchManifest`, `fetchLatest`, and `processBatch`.

**Key pattern for all online tests:**

- `resolveRegistry` is imported fresh in each test via dynamic import to avoid ESM cache issues with fetch mocking
- `globalThis.fetch` is replaced before calling and restored after via `afterEach`

- [ ] **Step 1: Add afterEach + 7 tests to `test/registry/client.test.ts`**

Append the following inside the existing `describe('registry client', () => { ... })` block (before the closing `})`):

```typescript
it('encodeName: scoped package encodes slash', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  const urls: string[] = []
  globalThis.fetch = async (input: string | URL | Request) => {
    urls.push(String(input))
    return { ok: false, json: async () => ({}) } as Response
  }
  try {
    await resolveRegistry([{ name: '@scope/pkg', version: '1.0.0' }], {
      offline: false
    })
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
  assert.ok(
    urls.some(u => u.includes('@scope%2Fpkg')),
    `expected encoded URL, got: ${urls}`
  )
})

it('fetchManifest: cache miss, fetch success returns engines', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({ engines: { node: '>=18' }, peerDependencies: {} })
    }) as Response
  try {
    const result = await resolveRegistry([{ name: 'test-manifest-miss-' + Date.now(), version: '1.0.0' }], { offline: false })
    assert.strictEqual(result[0].engines?.node, '>=18')
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})

it('fetchManifest: fetch !ok returns null (no engines enrichment)', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
  try {
    const result = await resolveRegistry([{ name: 'test-manifest-notok-' + Date.now(), version: '1.0.0' }], { offline: false })
    assert.strictEqual(result[0].engines, undefined)
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})

it('fetchManifest: fetch throws returns null (no crash)', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  try {
    const result = await resolveRegistry([{ name: 'test-manifest-throw-' + Date.now(), version: '1.0.0' }], { offline: false })
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].engines, undefined)
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})

it('fetchLatest: cache miss, fetch success returns latestVersion', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async (input: string | URL | Request) => {
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
    const result = await resolveRegistry([{ name: 'test-latest-miss-' + Date.now(), version: '1.0.0' }], { offline: false })
    assert.strictEqual(result[0].latestVersion, '5.0.0')
    assert.strictEqual(result[0].latestEngines?.node, '>=20')
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})

it('fetchLatest: fetch !ok leaves latestVersion undefined', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
  try {
    const result = await resolveRegistry([{ name: 'test-latest-notok-' + Date.now(), version: '1.0.0' }], { offline: false })
    assert.strictEqual(result[0].latestVersion, undefined)
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})

it('processBatch: more than CONCURRENCY=8 packages all returned', async () => {
  const { resolveRegistry } = await import('../../src/registry/client.js')
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response
  const pkgs = Array.from({ length: 10 }, (_, i) => ({
    name: `test-batch-pkg-${i}-${Date.now()}`,
    version: '1.0.0'
  }))
  try {
    const result = await resolveRegistry(pkgs, { offline: false })
    assert.strictEqual(result.length, 10)
  } finally {
    // @ts-ignore
    delete globalThis.fetch
  }
})
```

- [ ] **Step 2: Run the registry client tests**

Run: `npm test -- --test-name-pattern "registry client"` Expected: All 9 tests pass (2 existing + 7 new).

- [ ] **Step 3: Run full suite to verify no regressions**

Run: `npm test` Expected: All tests pass, 0 fail.

---

## Task 2: Graph traversal — npm v1, yarn-classic, yarn-berry

**File:** `test/graph/index.test.ts`

Three uncovered paths in `buildEdgeMap`: npm v1 (`dependencies[X].requires`), yarn-classic (lines 69–89), and the yarn-berry no-op.

- [ ] **Step 1: Add 3 tests inside the existing `describe('filterDevPackages', () => { ... })` block**

Append before the closing `})`:

```typescript
it('npm v1 lockfile: follows requires edges', () => {
  const v1Content = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      express: { version: '4.18.2', requires: { 'body-parser': '1.20.1' } },
      'body-parser': { version: '1.20.1', requires: {} },
      typescript: { version: '5.0.4', requires: {} }
    }
  })
  // fixturesDir has package.json with express as prod dep, typescript as devDep
  const result = filterDevPackages(allPackages, fixturesDir, v1Content, 'npm')
  const names = result.map(p => p.name)
  assert.ok(names.includes('express'), 'express retained (prod dep)')
  assert.ok(names.includes('body-parser'), 'body-parser retained (transitive prod)')
  assert.ok(!names.includes('typescript'), 'typescript excluded (dev only)')
})

it('yarn-classic: excludes dev-only packages', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf8')
  // fixturesDir/package.json: express=prod, typescript=dev
  const result = filterDevPackages(allPackages, fixturesDir, content, 'yarn-classic')
  const names = result.map(p => p.name)
  assert.ok(names.includes('express'), 'express retained')
  assert.ok(!names.includes('typescript'), 'typescript excluded')
})

it('yarn-berry: returns all packages unchanged (no edge data)', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf8')
  // yarn-berry buildEdgeMap is a no-op: no package can be proven dev-only
  const result = filterDevPackages(allPackages, fixturesDir, content, 'yarn-berry')
  assert.strictEqual(result.length, allPackages.length)
})
```

- [ ] **Step 2: Run graph tests**

Run: `npm test -- --test-name-pattern "filterDevPackages"` Expected: All 7 tests pass (4 existing + 3 new).

---

## Task 3: Output table — latestConflicts rendering block

**File:** `test/output/table.test.ts`

Lines 88–100 in `table.ts` render the `latestConflicts` section. No existing test populates `latestConflicts`.

- [ ] **Step 1: Add 1 test inside the existing `describe('renderOutput', () => { ... })` block**

Append before the closing `})`:

```typescript
it('shows latestConflicts warning', () => {
  const withLatestConflicts: AnalysisTarget[] = [
    {
      ...targets[0],
      latestConflicts: [{ package: 'old-pkg', version: '2.0.0', range: '<20.0.0' }]
    }
  ]
  const output = renderOutput(withLatestConflicts, 10, [], 'package-lock.json', 'npm', false, false)
  assert.ok(output.includes('old-pkg'), 'latestConflicts package name appears in output')
  assert.ok(output.includes('block upgrade'), 'latestConflicts header appears')
})
```

- [ ] **Step 2: Run table tests**

Run: `npm test -- --test-name-pattern "renderOutput"` Expected: All 5 tests pass (4 existing + 1 new).

---

## Task 4: Analyzer gaps — engines wildcard, peers latestPeerDeps, intersect null minVersion

**Files:** `test/analyzer/engines.test.ts`, `test/analyzer/peers.test.ts`, `test/analyzer/intersect.test.ts`

- [ ] **Step 1: Add wildcard range test to `test/analyzer/engines.test.ts`**

Append inside `describe('analyzeEngines', () => { ... })` before the closing `})`:

```typescript
it('ignores packages with wildcard engines.node = "*"', () => {
  const packages: Package[] = [
    { name: 'a', version: '1.0.0', engines: { node: '*' } },
    { name: 'b', version: '2.0.0', engines: { node: '>=18.0.0' } }
  ]
  const targets = analyzeEngines(packages, 'npm')
  const nodeTarget = targets.find(t => t.name === 'node')
  assert.ok(nodeTarget, 'node target exists')
  assert.ok(
    nodeTarget.ranges.every(r => r.package !== 'a'),
    'package with wildcard excluded from ranges'
  )
  assert.strictEqual(nodeTarget.ranges.length, 1)
})
```

- [ ] **Step 2: Add latestPeerDependencies test to `test/analyzer/peers.test.ts`**

Append inside `describe('analyzePeers', () => { ... })` before the closing `})`:

```typescript
it('collects latestPeerDependencies ranges', () => {
  const packages: Package[] = [
    {
      name: 'some-lib',
      version: '1.0.0',
      latestVersion: '2.0.0',
      peerDependencies: { react: '>=16.0.0' },
      latestPeerDependencies: { react: '>=18.0.0' }
    }
  ]
  const targets = analyzePeers(packages, ['react'])
  const reactTarget = targets.find(t => t.name === 'react')
  assert.ok(reactTarget, 'react target exists')
  assert.strictEqual(reactTarget.latestRanges.length, 1)
  assert.strictEqual(reactTarget.latestRanges[0].range, '>=18.0.0')
  assert.strictEqual(reactTarget.latestRanges[0].version, '2.0.0')
})
```

- [ ] **Step 3: Add null-minVersion sort test to `test/analyzer/intersect.test.ts`**

Append inside `describe('computeIntersection', () => { ... })` before the closing `})`:

```typescript
it('handles ranges where semver.minVersion returns null without crashing', () => {
  // '>1.0.0-0' is a valid range but semver.minVersion returns null for some exclusive ranges
  const result = computeIntersection([
    { package: 'a', version: '1.0.0', range: '>=2.0.0' },
    { package: 'b', version: '2.0.0', range: '>1.0.0-0' }
  ])
  // Both ranges overlap — should not throw and should return a non-null intersection or conflicts
  assert.ok(result.intersection !== undefined)
  assert.ok(Array.isArray(result.conflicts))
})
```

- [ ] **Step 4: Run the three analyzer test files**

Run: `npm test -- --test-name-pattern "(analyzeEngines|analyzePeers|computeIntersection)"` Expected: All analyzer tests pass.

---

## Task 5: Cache — non-XDG getCacheDir path

**File:** `test/cache/index.test.ts`

The existing test sets `process.env.XDG_CACHE_HOME` at module level, so the `if (xdg)` branch in `getCacheDir` is always taken. The `envPaths(...)` fallback (lines 14–18) is never reached. We test `getCacheDir` directly with XDG unset.

`getCacheDir` is already exported from `src/cache/index.ts`. We need to add it to the import.

- [ ] **Step 1: Add `getCacheDir` to the import in `test/cache/index.test.ts`**

Change the existing import:

```typescript
import { getVersionData, setVersionData, getLatestData, setLatestData } from '../../src/cache/index.js'
```

To:

```typescript
import { getCacheDir, getVersionData, setVersionData, getLatestData, setLatestData } from '../../src/cache/index.js'
```

- [ ] **Step 2: Add 1 test inside `describe('cache', () => { ... })` before the closing `})`**

```typescript
it('getCacheDir: falls back to envPaths when XDG_CACHE_HOME is unset', () => {
  const prev = process.env.XDG_CACHE_HOME
  delete process.env.XDG_CACHE_HOME
  try {
    const dir = getCacheDir()
    assert.ok(typeof dir === 'string' && dir.length > 0, 'returns a non-empty string')
    assert.ok(dir.includes('semver-ranger'), 'path includes semver-ranger')
  } finally {
    if (prev !== undefined) process.env.XDG_CACHE_HOME = prev
  }
})
```

- [ ] **Step 3: Run cache tests**

Run: `npm test -- --test-name-pattern "cache"` Expected: All 6 tests pass (5 existing + 1 new).

---

## Task 6: Parser gaps — npm v1, pnpm branches, yarn-classic failure, yarn-berry no-version

**Files:** `test/parsers/npm.test.ts`, `test/parsers/pnpm.test.ts`, `test/parsers/yarn-classic.test.ts`, `test/parsers/yarn-berry.test.ts`

- [ ] **Step 1: Add npm v1 test to `test/parsers/npm.test.ts`**

The `package-lock-v1.json` fixture at `test/fixtures/package-lock-v1.json` has:

```json
{
  "lockfileVersion": 1,
  "dependencies": {
    "express": { "version": "4.18.2" },
    "body-parser": { "version": "1.20.1" }
  }
}
```

Append inside `describe('parseNpmLockfile', () => { ... })` before the closing `})`:

```typescript
it('parses v1 lockfile via dependencies block', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock-v1.json'), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0, 'returns packages')
  const express = packages.find(p => p.name === 'express')
  assert.ok(express, 'express found')
  assert.strictEqual(express.version, '4.18.2')
  // v1 has no engines data
  assert.strictEqual(express.engines, undefined)
})
```

- [ ] **Step 2: Add 2 pnpm branch tests to `test/parsers/pnpm.test.ts`**

Append inside `describe('parsePnpmLockfile', () => { ... })` before the closing `})`:

```typescript
it('handles package with no engines field', () => {
  const content = ["lockfileVersion: '6.0'", 'packages:', '  /lodash@4.17.21:', '    resolution: { integrity: sha512-abc }', ''].join('\n')
  const packages = parsePnpmLockfile(content)
  const lodash = packages.find(p => p.name === 'lodash')
  assert.ok(lodash, 'lodash found')
  assert.strictEqual(lodash.engines, undefined)
})

it('extracts peerDependencies from pnpm v6 entry', () => {
  const content = ["lockfileVersion: '6.0'", 'packages:', '  /react-dom@18.0.0:', '    resolution: { integrity: sha512-abc }', '    peerDependencies:', '      react: ^18.0.0', ''].join('\n')
  const packages = parsePnpmLockfile(content)
  const pkg = packages.find(p => p.name === 'react-dom')
  assert.ok(pkg, 'react-dom found')
  assert.strictEqual(pkg.peerDependencies?.react, '^18.0.0')
  assert.strictEqual(pkg.engines, undefined)
})
```

- [ ] **Step 3: Add yarn-classic parse failure test to `test/parsers/yarn-classic.test.ts`**

Append inside `describe('parseYarnClassicLockfile', () => { ... })` before the closing `})`:

```typescript
it('throws on invalid lockfile content', () => {
  assert.throws(
    () => parseYarnClassicLockfile('this is not a valid lockfile :::'),
    (err: Error) => err.message.includes('Failed to parse')
  )
})
```

- [ ] **Step 4: Add yarn-berry no-version test to `test/parsers/yarn-berry.test.ts`**

Append inside `describe('parseYarnBerryLockfile', () => { ... })` before the closing `})`:

```typescript
it('skips entries with no version field', () => {
  // Minimal berry lockfile with one entry missing version
  const content = ['__metadata:', '  version: 6', '', '"no-version-pkg@npm:^1.0.0":', '  resolution: "no-version-pkg@npm:1.0.0"', '  languageName: node', ''].join('\n')
  const packages = parseYarnBerryLockfile(content)
  // Entry has no `version:` field — should be skipped
  assert.strictEqual(packages.length, 0)
})
```

- [ ] **Step 5: Run all parser tests**

Run: `npm test -- --test-name-pattern "(parseNpmLockfile|parsePnpmLockfile|parseYarnClassicLockfile|parseYarnBerryLockfile)"` Expected: All parser tests pass.

---

## Task 7: Final verification — coverage report

- [ ] **Step 1: Run full test suite**

Run: `npm test` Expected: All tests pass (47 original + ~20 new = ~67 total), 0 fail.

- [ ] **Step 2: Run coverage**

Run: `npm run cov` Expected improvements vs baseline:

- `src/registry/client.ts` line coverage ≥ 90% (was 65%)
- `src/graph/index.ts` line coverage ≥ 95% (was 89%)
- `src/registry/client.ts` function coverage ≥ 80% (was 33%)
- Branch coverage improves across all parser files
- Overall: ≥ 95% lines, ≥ 85% branches

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit` Expected: Exit 0, no errors.

---

## Self-Review

**Spec coverage:**

- ✅ Section 1 (registry/client fetch mocking — 7 tests) → Task 1
- ✅ Section 2 (graph: npm v1, yarn-classic, yarn-berry) → Task 2
- ✅ Section 3 table latestConflicts → Task 3
- ✅ Section 3 peers latestPeerDependencies → Task 4
- ✅ Section 3 engines wildcard → Task 4
- ✅ Section 3 intersect null minVersion → Task 4
- ✅ Section 3 cache XDG_CACHE_HOME → Task 5
- ✅ Section 3 npm v1 → Task 6
- ✅ Section 3 pnpm branches → Task 6
- ✅ Section 3 yarn-classic failure branch → Task 6
- ✅ Section 3 yarn-berry no-version → Task 6

**Placeholder scan:** No TBDs or vague steps — all test code is complete and shown inline.

**Type consistency:** All types (`Package`, `AnalysisTarget`) match the existing test file imports. `getCacheDir` is added to the cache import. No new imports required elsewhere.
