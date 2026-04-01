# semver-ranger — Test Coverage Gap Filling

**Date:** 2026-03-30 **Status:** Approved

---

## Context

Running `npm run cov` (Node.js experimental test coverage) reveals the following gaps across the TypeScript source. The goal is to raise coverage by adding tests to existing test files — no new source files, no new test files beyond what already exists.

Overall baseline: 92.50% lines, 79.06% branches, 91.23% functions.

---

## Coverage Gaps

| File                          | Line % | Branch % | Uncovered lines / notes                                |
| ----------------------------- | ------ | -------- | ------------------------------------------------------ |
| `src/registry/client.ts`      | 65.04  | 75.00    | 12–13, 15–28, 31–38, 41–55, 60–63 — all network paths  |
| `src/graph/index.ts`          | 88.89  | 72.41    | 23–25 (interface), 40–53 — npm v1 + yarn-classic paths |
| `src/output/table.ts`         | 93.06  | 81.82    | 54–65 — `latestConflicts` block; 1 function uncovered  |
| `src/analyzer/peers.ts`       | 97.03  | 75.00    | 41, 43–44 — `latestPeerDependencies` path              |
| `src/analyzer/engines.ts`     | 98.59  | 82.35    | 14 — wildcard `'*'` range ignored                      |
| `src/cache/index.ts`          | 98.18  | 93.75    | 13–14 — `XDG_CACHE_HOME` env var path                  |
| `src/parsers/npm.ts`          | 96.43  | 76.92    | 22–23 — v1 lockfile branch                             |
| `src/parsers/pnpm.ts`         | 100.00 | 64.29    | branch gaps: missing engines / missing peerDeps        |
| `src/parsers/yarn-classic.ts` | 100.00 | 57.14    | branch gaps: `dependencies:` block, empty-line reset   |
| `src/parsers/yarn-berry.ts`   | 100.00 | 75.00    | branch gaps: packages with/without engines             |
| `src/analyzer/intersect.ts`   | 100.00 | 78.95    | branch gap: `semver.minVersion` returning null         |

---

## Section 1: Registry Client — Fetch Mocking

**File:** `test/registry/client.test.ts`

**Approach:** Mock `globalThis.fetch` within each test. Restore after each test using `afterEach`. Use unique package names (e.g., `test-fetchmanifest-abc`) to avoid cache collisions with other test runs.

**Tests to add (7):**

1. **encodeName scoped package** — call `resolveRegistry` online with a package whose name starts with `@scope/name`, pre-set a mock fetch that captures the URL. Assert the URL contains `@scope%2Fname`.

2. **fetchManifest cache miss → success** — mock `fetch` returns `{ ok: true, json: () => ({ engines: { node: '>=18' }, peerDependencies: { react: '>=17' } }) }`. Assert returned package has `engines.node === '>=18'`.

3. **fetchManifest !res.ok** — mock `fetch` returns `{ ok: false }`. Assert returned package has no engines (package's original engines are preserved from `pkg.engines ?? undefined`).

4. **fetchManifest network throws** — mock `fetch` throws `new Error('ECONNREFUSED')`. Assert call completes without throwing and package is returned unchanged.

5. **fetchLatest cache miss → success** — mock `fetch` for `/latest` returns `{ ok: true, json: () => ({ version: '5.0.0', engines: { node: '>=20' } }) }`. Assert `latestVersion === '5.0.0'` and `latestEngines.node === '>=20'`.

6. **fetchLatest !res.ok** — mock `fetch` returns `{ ok: false }`. Assert `latestVersion` is undefined.

7. **processBatch batching** — pass 10 packages (> CONCURRENCY=8) to online `resolveRegistry` with a mock fetch that always returns `{ ok: false }`. Assert all 10 packages are returned (verifies the batch loop runs for all items, not just first 8).

**Fetch mock pattern:**

```typescript
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

// Inside test:
globalThis.fetch = async (url: string | URL | Request) =>
  ({
    ok: true,
    json: async () => ({ version: '1.0.0', engines: { node: '>=18' } })
  }) as Response
```

---

## Section 2: Graph Traversal Gaps

**File:** `test/graph/index.test.ts`

**Tests to add (3):**

1. **npm v1 lockfile path** — pass an inline npm v1 lockfile string (with `dependencies["X"].requires`) to `filterDevPackages`. The v1 lock has no `packages` block, only `dependencies` with `requires`. Assert that transitive production deps are retained and dev-only packages are excluded.

   Inline fixture:

   ```json
   {
     "lockfileVersion": 1,
     "dependencies": {
       "express": {
         "version": "4.18.2",
         "requires": { "body-parser": "1.20.1" }
       },
       "body-parser": { "version": "1.20.1", "requires": {} },
       "typescript": { "version": "5.0.4", "requires": {} }
     }
   }
   ```

2. **yarn-classic edge building** — use the existing `test/fixtures/yarn-classic.lock` with `projectDir = fixturesDir` (which has `test/fixtures/package.json`). Assert that packages reachable only from devDependencies are excluded.

3. **yarn-berry fallback** — call `filterDevPackages` with `lockfileType: 'yarn-berry'`. Since berry is intentionally skipped in `buildEdgeMap`, the result is empty edges — no package can be proven to be dev-only, so all packages are returned unchanged. Assert `result.length === allPackages.length`.

---

## Section 3: Small Gaps

Each of the following adds 1–2 tests to an existing test file.

### `test/output/table.test.ts` — latestConflicts block

Add a target with `latestConflicts` populated:

```typescript
const withLatestConflicts: AnalysisTarget[] = [
  {
    ...targets[0],
    latestConflicts: [{ package: 'old-pkg', version: '2.0.0', range: '<20.0.0' }]
  }
]
const output = renderOutput(withLatestConflicts, 10, [], 'package-lock.json', 'npm', false, false)
assert.ok(output.includes('old-pkg'))
```

### `test/analyzer/peers.test.ts` — latestPeerDependencies path

Add a package with `latestPeerDependencies`:

```typescript
const pkgs: Package[] = [
  {
    name: 'some-lib',
    version: '1.0.0',
    latestVersion: '2.0.0',
    peerDependencies: { react: '>=16' },
    latestPeerDependencies: { react: '>=18' }
  }
]
const result = analyzePeers(pkgs, ['react'])
assert.strictEqual(result[0].latestRanges[0].range, '>=18')
assert.strictEqual(result[0].latestRanges[0].version, '2.0.0')
```

### `test/analyzer/engines.test.ts` — wildcard range ignored

```typescript
const pkgs: Package[] = [
  { name: 'a', version: '1.0.0', engines: { node: '*' } },
  { name: 'b', version: '2.0.0', engines: { node: '>=18' } }
]
const result = analyzeEngines(pkgs, 'npm')
const nodeTarget = result.find(t => t.name === 'node')
assert.ok(nodeTarget)
// wildcard '*' should be excluded from ranges
assert.ok(nodeTarget.ranges.every(r => r.package !== 'a'))
```

### `test/analyzer/intersect.test.ts` — null minVersion branch

```typescript
it('handles range where minVersion returns null', () => {
  const result = computeIntersection([
    { package: 'a', version: '1.0.0', range: '>1.0.0-0' },
    { package: 'b', version: '2.0.0', range: '>=2.0.0' }
  ])
  // Should not throw; intersection or null is acceptable
  assert.ok(result.intersection !== undefined)
})
```

### `test/cache/index.test.ts` — XDG_CACHE_HOME path

```typescript
it('uses XDG_CACHE_HOME when set', () => {
  const prev = process.env.XDG_CACHE_HOME
  process.env.XDG_CACHE_HOME = '/tmp/test-xdg-semver'
  try {
    const dir = getCacheDir()
    assert.ok(dir.startsWith('/tmp/test-xdg-semver'))
    assert.ok(dir.includes('semver-ranger'))
  } finally {
    if (prev === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = prev
  }
})
```

### `test/parsers/npm.test.ts` — v1 lockfile branch

Use the existing `package-lock-v1.json` fixture (already present from previous session):

```typescript
it('parses v1 lockfile', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock-v1.json'), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  assert.ok(packages.every(p => p.name && p.version))
})
```

### `test/parsers/pnpm.test.ts` — branch gaps

```typescript
it('handles package with no engines', () => {
  const content = `lockfileVersion: '6.0'\npackages:\n  /lodash@4.17.21:\n    resolution: { integrity: sha512-abc }\n`
  const packages = parsePnpmLockfile(content)
  const lodash = packages.find(p => p.name === 'lodash')
  assert.ok(lodash)
  assert.strictEqual(lodash.engines, undefined)
})

it('extracts peerDependencies from pnpm lockfile', () => {
  const content = `lockfileVersion: '6.0'\npackages:\n  /react-dom@18.0.0:\n    resolution: { integrity: sha512-abc }\n    peerDependencies:\n      react: ^18.0.0\n`
  const packages = parsePnpmLockfile(content)
  const pkg = packages.find(p => p.name === 'react-dom')
  assert.ok(pkg)
  assert.strictEqual(pkg.peerDependencies?.react, '^18.0.0')
})
```

### `test/parsers/yarn-classic.test.ts` — dependencies block branch

Add a fixture entry with a `dependencies:` block to the inline content, or extend the existing fixture. Assert the parser includes the package.

### `test/parsers/yarn-berry.test.ts` — branch gaps

Add a test for a package that has `engines` field and one without. The fixture should already cover this; if branches are uncovered it may be about the metadata handling. Read the yarn-berry parser to confirm before implementing.

---

## File Map

```
Modified:
  test/registry/client.test.ts       ← 7 tests (fetch mock)
  test/graph/index.test.ts           ← 3 tests (npm v1, yarn-classic, yarn-berry)
  test/output/table.test.ts          ← 1 test (latestConflicts)
  test/analyzer/engines.test.ts      ← 1 test (wildcard range)
  test/analyzer/peers.test.ts        ← 1 test (latestPeerDependencies)
  test/analyzer/intersect.test.ts    ← 1 test (null minVersion)
  test/cache/index.test.ts           ← 1 test (XDG_CACHE_HOME)
  test/parsers/npm.test.ts           ← 1 test (v1 lockfile)
  test/parsers/pnpm.test.ts          ← 2 tests (no engines, peerDeps)
  test/parsers/yarn-classic.test.ts  ← 1 test (dependencies block)
  test/parsers/yarn-berry.test.ts    ← 1 test (branch gap)
```

---

## Success Criteria

- All existing 47 tests continue to pass
- `npm run cov` shows:
  - `src/registry/client.ts` line coverage ≥ 90%
  - `src/graph/index.ts` line coverage ≥ 95%
  - All other files already ≥ 96%; branch coverage improves across the board
- No new source files created
- No mocking libraries added (use `globalThis.fetch` assignment only)
