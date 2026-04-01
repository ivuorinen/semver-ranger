# Bug Fixes, --no-dev Graph Traversal, and Publish Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five bugs in the TypeScript codebase, implement transitive `--no-dev` filtering, and add CI/publish GitHub Actions workflows.

**Architecture:** Each bug is an isolated fix in a single file. The `--no-dev` feature adds a new `src/graph/index.ts` module wired into `src/cli.ts`. The three workflow files are independent YAML additions.

**Tech Stack:** TypeScript, Node.js test runner, semver, yaml, GitHub Actions, semantic-release

---

## File Map

```
Modified:
  src/parsers/pnpm.ts              ← Bug 1: pnpm v9 engine data from packages block
  src/output/table.ts              ← Bug 2: --all rendering + signature change
  src/registry/client.ts           ← Bug 3: remove cacheDir from ResolveOptions
  src/cli.ts                       ← Bug 3 callsite + --no-dev wiring
  src/analyzer/intersect.ts        ← Bug 4: sort ranges before greedy pass
  .github/workflows/pr-lint.yml    ← add workflow_call trigger, remove master branch

Created:
  src/graph/index.ts               ← --no-dev transitive graph traversal
  test/graph/index.test.ts
  .github/workflows/ci.yml
  .github/workflows/publish.yml

Extended tests:
  test/parsers/pnpm.test.ts        ← v9 fixture + engine data test
  test/analyzer/intersect.test.ts  ← order-independence test
  test/output/table.test.ts        ← --all unconstrained packages test
  test/fixtures/pnpm-lock-v9.yaml  ← new fixture
```

---

## Task 1: Bug 1 — pnpm v9 engine data

**Files:**

- Modify: `src/parsers/pnpm.ts`
- Modify: `test/parsers/pnpm.test.ts`
- Create: `test/fixtures/pnpm-lock-v9.yaml`

- [ ] **Step 1: Create pnpm v9 fixture**

Create `test/fixtures/pnpm-lock-v9.yaml`:

```yaml
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      express:
        specifier: ^4.18.2
        version: 4.18.2

packages:
  express@4.18.2:
    resolution: { integrity: sha512-abc }
    engines: { node: '>= 0.10.0' }

snapshots:
  express@4.18.2:
    dependencies:
      body-parser: 1.20.1

  body-parser@1.20.1: {}
```

- [ ] **Step 2: Write the failing test**

Add to `test/parsers/pnpm.test.ts`:

```typescript
it('extracts engines from pnpm v9 lockfile (packages block)', () => {
  const content = readFileSync(join(fixturesDir, 'pnpm-lock-v9.yaml'), 'utf8')
  const packages = parsePnpmLockfile(content)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express, 'express package found')
  assert.strictEqual(express.engines?.node, '>= 0.10.0')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "v9 lockfile"` Expected: FAIL — `express.engines` is `undefined` because the v9 parser reads `snapshots` which has no `engines`.

- [ ] **Step 4: Fix `src/parsers/pnpm.ts`**

Change the parser to use `packages` for metadata and `snapshots ?? packages` for name/version iteration:

```typescript
export function parsePnpmLockfile(content: string): Package[] {
  const lock = parseYaml(content) as PnpmLock

  const metaBlock = lock.packages ?? {}
  const versionBlock = lock.snapshots ?? lock.packages ?? {}
  const result: Package[] = []
  const seen = new Set<string>()

  for (const [key] of Object.entries(versionBlock)) {
    const parsed = extractNameVersion(key)
    if (!parsed) continue
    const { name, version } = parsed

    const dedupKey = `${name}@${version}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    // Look up metadata from packages block (has engines/peerDeps in v9)
    const meta = metaBlock[key] ?? {}

    result.push({
      name,
      version,
      engines: meta.engines,
      peerDependencies: meta.peerDependencies
    })
  }

  return result
}
```

- [ ] **Step 5: Run tests and verify pass**

Run: `npm test -- --test-name-pattern "parsePnpmLockfile"` Expected: All 3 pnpm tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/parsers/pnpm.ts test/parsers/pnpm.test.ts test/fixtures/pnpm-lock-v9.yaml
git commit -m "fix(pnpm): read engines from packages block in v9 lockfiles"
```

---

## Task 2: Bug 2 — `--all` renders unconstrained packages

**Files:**

- Modify: `src/output/table.ts`
- Modify: `src/cli.ts`
- Modify: `test/output/table.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/output/table.test.ts`:

```typescript
it('--all shows packages with no constraint', () => {
  const allPkgs: Package[] = [
    { name: 'express', version: '4.18.2' },
    { name: 'lodash', version: '4.17.21' }, // not in any target.ranges
    { name: 'typescript', version: '5.0.4' }
  ]
  const output = renderOutput(targets, 247, allPkgs, 'package-lock.json', 'npm', true, false)
  assert.ok(output.includes('lodash'), 'lodash appears in --all output')
})
```

Note: you need to add `import type { Package } from '../../src/types.js'` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "all shows packages"` Expected: FAIL — `renderOutput` doesn't accept 7 arguments yet.

- [ ] **Step 3: Update `src/output/table.ts` function signatures**

Update `renderTarget` signature and body:

```typescript
/**
 * Renders a single analysis target section as a formatted string.
 * @param {AnalysisTarget} target The analysis target to render.
 * @param {Package[]} allPackages All packages in the lockfile.
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @returns {string} Formatted multi-line string for the target section.
 */
function renderTarget(target: AnalysisTarget, allPackages: Package[], showAll: boolean): string {
  const ui = makeUi()
  const totalDeclaring = target.ranges.length

  ui.div(`  ${target.name} (${target.source})   ${totalDeclaring} package(s) declare a constraint`)
  ui.div(`  ${'─'.repeat(WIDTH - 4)}`)

  ui.div({ text: '  Safe range (installed):', width: 30 }, { text: target.intersection ?? '⚠  conflict — no safe range', width: 50 })
  ui.div(
    { text: '  Safe range (latest):', width: 30 },
    {
      text: target.latestIntersection ?? '⚠  conflict — no safe range',
      width: 50
    }
  )

  if (target.ranges.length > 0) {
    ui.div('')
    ui.div('  Most restrictive (installed):')
    ui.div({ text: '  Package', width: COL_PKG }, { text: 'Installed', width: COL_VER }, { text: 'Latest', width: COL_LATEST }, { text: 'Range', width: COL_RANGE })
    for (const entry of target.ranges) {
      const latest = target.latestRanges.find(r => r.package === entry.package)
      renderPackageRow(ui, entry, latest?.version ?? '—')
    }
  }

  if (target.conflicts.length > 0) {
    ui.div('')
    ui.div(`  ⚠  Conflicts at installed (${target.conflicts.length} package(s) cause conflict):`)
    for (const entry of target.conflicts) {
      renderPackageRow(ui, entry, '—', '  ⚠  ')
    }
  }

  if (target.latestConflicts.length > 0) {
    ui.div('')
    ui.div(`  ⚠  Conflicts at latest (${target.latestConflicts.length} package(s) block upgrade):`)
    for (const entry of target.latestConflicts) {
      const installed = target.ranges.find(r => r.package === entry.package)
      ui.div({ text: `  ⚠  ${entry.package}`, width: COL_PKG }, { text: installed?.version ?? '—', width: COL_VER }, { text: entry.version, width: COL_LATEST }, { text: entry.range, width: COL_RANGE })
    }
  }

  if (showAll) {
    const constrainedNames = new Set(target.ranges.map(r => r.package))
    const unconstrained = allPackages.filter(p => !constrainedNames.has(p.name))
    if (unconstrained.length > 0) {
      ui.div('')
      ui.div('  All packages (no constraint declared):')
      ui.div({ text: '  Package', width: COL_PKG }, { text: 'Installed', width: COL_VER }, { text: 'Latest', width: COL_LATEST }, { text: 'Range', width: COL_RANGE })
      for (const pkg of unconstrained) {
        ui.div({ text: '  ' + pkg.name, width: COL_PKG }, { text: pkg.version, width: COL_VER }, { text: pkg.latestVersion ?? '—', width: COL_LATEST }, { text: '—', width: COL_RANGE })
      }
    }
  }

  return ui.toString()
}
```

Update `renderOutput` signature and call site:

```typescript
/**
 * Renders the full analysis output as a formatted cliui table or JSON string.
 * @param {AnalysisTarget[]} targets Analysis targets to include in the output.
 * @param {number} totalPackages Total number of packages analyzed.
 * @param {Package[]} packages Full package list for --all rendering.
 * @param {string} lockfileName Filename of the detected lockfile.
 * @param {string} manager Package manager name (npm, yarn, pnpm).
 * @param {boolean} showAll Whether to include packages with no constraint declaration.
 * @param {boolean} json When true, returns a raw JSON string instead of a table.
 * @returns {string} The formatted output string.
 */
export function renderOutput(targets: AnalysisTarget[], totalPackages: number, packages: Package[], lockfileName: string, manager: string, showAll: boolean, json: boolean): string {
  if (json) {
    return JSON.stringify(targets, null, 2)
  }

  const ui = makeUi()

  ui.div(`semver-ranger — analyzing ${totalPackages} packages`)
  ui.div('')
  ui.div({ text: '  Lockfile:', width: 14 }, { text: `${lockfileName} (${manager})`, width: 60 })
  ui.div({ text: '  Targets:', width: 14 }, { text: targets.map(t => t.name).join(', ') || 'none', width: 60 })
  ui.div('')
  ui.div(SEP)

  const parts = [ui.toString()]

  for (const target of targets) {
    parts.push('')
    parts.push(renderTarget(target, packages, showAll))
    parts.push(SEP)
  }

  return parts.join('\n')
}
```

Add `import type { Package, AnalysisTarget, RangeEntry } from '../types.js'` to the top of `table.ts` (replace the existing import line which only imports `AnalysisTarget` and `RangeEntry`).

- [ ] **Step 4: Update `src/cli.ts` to pass `packages` to `renderOutput`**

Find this call in `src/cli.ts`:

```typescript
const output = renderOutput(allTargets, packages.length, basename(lockfilePath), manager, values.all ?? false, values.json ?? false)
```

Replace with:

```typescript
const output = renderOutput(allTargets, packages.length, packages, basename(lockfilePath), manager, values.all ?? false, values.json ?? false)
```

- [ ] **Step 5: Update existing table tests to pass `packages` argument**

In `test/output/table.test.ts`, the existing calls to `renderOutput` have 6 arguments. Add `[]` as the third argument (empty package list — safe for those tests which don't test `--all`):

Change every `renderOutput(targets, N, 'package-lock.json', ...)` to `renderOutput(targets, N, [], 'package-lock.json', ...)`.

- [ ] **Step 6: Run tests and verify pass**

Run: `npm test -- --test-name-pattern "renderOutput"` Expected: All 4 table tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/output/table.ts src/cli.ts test/output/table.test.ts
git commit -m "fix(output): implement --all flag to show unconstrained packages"
```

---

## Task 3: Bug 3 — Remove vestigial `cacheDir`

**Files:**

- Modify: `src/registry/client.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Remove `cacheDir` from `ResolveOptions` in `src/registry/client.ts`**

Change:

```typescript
interface ResolveOptions {
  offline: boolean
  cacheDir: string
}
```

To:

```typescript
interface ResolveOptions {
  offline: boolean
}
```

- [ ] **Step 2: Remove `cacheDir: ''` from the call site in `src/cli.ts`**

Change:

```typescript
packages = await resolveRegistry(packages, {
  offline: values.offline ?? false,
  cacheDir: ''
})
```

To:

```typescript
packages = await resolveRegistry(packages, {
  offline: values.offline ?? false
})
```

- [ ] **Step 3: Run all tests to verify nothing broke**

Run: `npm test` Expected: All 40 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/registry/client.ts src/cli.ts
git commit -m "fix(registry): remove unused cacheDir from ResolveOptions"
```

---

## Task 4: Bug 4 — Deterministic intersection sorting

**Files:**

- Modify: `src/analyzer/intersect.ts`
- Modify: `test/analyzer/intersect.test.ts`

- [ ] **Step 1: Write the failing order-independence test**

Add to `test/analyzer/intersect.test.ts`:

```typescript
it('produces consistent conflicts regardless of input order', () => {
  const rangeA = { package: 'a', version: '1.0.0', range: '>=14.0.0 <18.0.0' }
  const rangeB = { package: 'b', version: '2.0.0', range: '>=20.0.0' }
  const rangeC = { package: 'c', version: '3.0.0', range: '>=16.0.0 <21.0.0' }

  const orderABC = computeIntersection([rangeA, rangeB, rangeC])
  const orderBAC = computeIntersection([rangeB, rangeA, rangeC])
  const orderCAB = computeIntersection([rangeC, rangeA, rangeB])

  // All orderings should agree on whether there is a conflict
  assert.strictEqual(orderABC.intersection, orderBAC.intersection)
  assert.strictEqual(orderABC.intersection, orderCAB.intersection)

  // rangeB (>=20) should always be in conflicts — it cannot intersect >=14 <18
  assert.ok(orderABC.conflicts.some(c => c.package === 'b'))
  assert.ok(orderBAC.conflicts.some(c => c.package === 'b'))
  assert.ok(orderCAB.conflicts.some(c => c.package === 'b'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern "consistent conflicts"` Expected: FAIL — one or more orderings disagree on intersection/conflicts.

- [ ] **Step 3: Fix `src/analyzer/intersect.ts` with sort-before-greedy**

Replace the `computeIntersection` function body:

```typescript
export function computeIntersection(ranges: RangeEntry[]): IntersectionResult {
  const valid = ranges.filter(r => r.range !== '*' && semver.validRange(r.range) !== null)

  if (valid.length === 0) {
    return { intersection: null, conflicts: [] }
  }

  // Sort by minimum version ascending for deterministic greedy pass
  const sorted = [...valid].sort((a, b) => {
    const minA = semver.minVersion(a.range)
    const minB = semver.minVersion(b.range)
    if (!minA && !minB) return 0
    if (!minA) return 1
    if (!minB) return -1
    return semver.compare(minA, minB)
  })

  const conflicts: RangeEntry[] = []
  let combined = sorted[0].range

  for (let i = 1; i < sorted.length; i++) {
    const entry = sorted[i]
    if (!semver.intersects(combined, entry.range)) {
      conflicts.push(entry)
    } else {
      combined = `${combined} ${entry.range}`
    }
  }

  if (conflicts.length > 0) {
    return { intersection: null, conflicts }
  }

  return { intersection: semver.validRange(combined), conflicts: [] }
}
```

- [ ] **Step 4: Run all tests and verify pass**

Run: `npm test -- --test-name-pattern "computeIntersection"` Expected: All 5 intersection tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/intersect.ts test/analyzer/intersect.test.ts
git commit -m "fix(intersect): sort ranges by min-version for deterministic conflict detection"
```

---

## Task 5: `--no-dev` — transitive graph traversal module

**Files:**

- Create: `src/graph/index.ts`
- Create: `test/graph/index.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create test fixtures for graph traversal**

Create `test/fixtures/package-graph.json` (a minimal package.json representing a project with both prod and dev deps):

```json
{
  "name": "test-project",
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write failing tests for `filterDevPackages`**

Create `test/graph/index.test.ts`:

```typescript
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterDevPackages } from '../../src/graph/index.js'
import type { Package } from '../../src/types.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

const allPackages: Package[] = [
  { name: 'express', version: '4.18.2' },
  { name: 'body-parser', version: '1.20.1' }, // transitive prod dep
  { name: 'typescript', version: '5.0.4' } // dev dep
]

describe('filterDevPackages', () => {
  it('excludes packages only reachable via devDependencies (npm v3)', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const result = filterDevPackages(allPackages, fixturesDir, content, 'npm')
    const names = result.map(p => p.name)
    assert.ok(names.includes('express'), 'express kept (prod dep)')
    assert.ok(!names.includes('typescript'), 'typescript excluded (dev dep)')
  })

  it('excludes packages only reachable via devDependencies (pnpm)', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const result = filterDevPackages(allPackages, fixturesDir, content, 'pnpm')
    const names = result.map(p => p.name)
    assert.ok(names.includes('express'), 'express kept')
    assert.ok(!names.includes('typescript'), 'typescript excluded')
  })

  it('retains packages shared between prod and dev', () => {
    const shared: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'typescript', version: '5.0.4' } // also a prod dep here
    ]
    // Use a package.json that has typescript in both deps and devDeps
    const pkgJson = JSON.stringify({
      dependencies: { express: '^4', typescript: '^5' },
      devDependencies: { typescript: '^5' }
    })
    // Write temp package.json to a tmpdir — use fixturesDir/graph-shared/ subfixture
    // For simplicity, test via a direct package list from a real fixture dir that has
    // typescript in dependencies. We'll use a fixture dir approach.
    // Actually: filterDevPackages reads package.json from projectDir.
    // Use the fixtures/graph-shared dir we create in the next step.
    const sharedDir = join(fixturesDir, 'graph-shared')
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const result = filterDevPackages(shared, sharedDir, content, 'npm')
    // typescript is in dependencies of graph-shared/package.json → retained
    const names = result.map(p => p.name)
    assert.ok(names.includes('typescript'), 'typescript retained when also a prod dep')
  })

  it('returns packages unchanged when package.json not found', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const result = filterDevPackages(allPackages, '/nonexistent/path', content, 'npm')
    assert.strictEqual(result.length, allPackages.length)
  })
})
```

- [ ] **Step 3: Create fixture directory for shared-dep test**

Create `test/fixtures/graph-shared/package.json`:

```json
{
  "name": "graph-shared-test",
  "dependencies": {
    "express": "^4.18.2",
    "typescript": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "filterDevPackages"` Expected: FAIL — module does not exist yet.

- [ ] **Step 5: Implement `src/graph/index.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Package, LockfileType } from '../types.js'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Builds a map from package name to list of direct dependency names.
 * @param {string} content Raw lockfile content.
 * @param {LockfileType} type The lockfile format.
 * @returns {Map<string, string[]>} Map of package name to dependency names.
 */
function buildEdgeMap(content: string, type: LockfileType): Map<string, string[]> {
  const edges = new Map<string, string[]>()

  if (type === 'npm') {
    interface NpmLock {
      lockfileVersion?: number
      packages?: Record<string, { dependencies?: Record<string, string> }>
      dependencies?: Record<
        string,
        {
          requires?: Record<string, string>
          dependencies?: Record<string, unknown>
        }
      >
    }
    const lock = JSON.parse(content) as NpmLock

    if (lock.lockfileVersion === 3 || (lock.lockfileVersion === 2 && lock.packages)) {
      for (const [key, entry] of Object.entries(lock.packages ?? {})) {
        if (!key.startsWith('node_modules/')) continue
        const name = key.slice('node_modules/'.length)
        edges.set(name, Object.keys(entry.dependencies ?? {}))
      }
    } else {
      // v1
      for (const [name, entry] of Object.entries(lock.dependencies ?? {})) {
        edges.set(name, Object.keys(entry.requires ?? {}))
      }
    }
  } else if (type === 'pnpm') {
    interface PnpmLock {
      packages?: Record<string, { dependencies?: Record<string, string> }>
      snapshots?: Record<string, { dependencies?: Record<string, string> }>
    }
    const lock = parseYaml(content) as PnpmLock
    const block = lock.packages ?? {}
    for (const [key, entry] of Object.entries(block)) {
      // Extract name from /pkg@ver or pkg@ver
      const stripped = key.replace(/\([^)]*\)/gu, '').trim()
      const match = stripped.match(/^\/(@[^/]+\/[^@]+|[^@/][^@]*)@/u) ?? stripped.match(/^(@[^/]+\/[^@]+|[^@]+)@/u)
      if (!match) continue
      const name = match[1]
      edges.set(name, Object.keys(entry.dependencies ?? {}))
    }
  } else if (type === 'yarn-classic') {
    // Simple line-based parse: look for "  dependencies:" blocks
    let currentPkg: string | null = null
    let inDeps = false
    const deps: string[] = []
    for (const line of content.split('\n')) {
      const pkgMatch = line.match(/^"?([^@\s"]+(?:@[^@\s"]+)?)@/u)
      if (pkgMatch && !line.startsWith(' ')) {
        if (currentPkg !== null) edges.set(currentPkg, [...deps])
        currentPkg = pkgMatch[1].split('@')[0]
        inDeps = false
        deps.length = 0
      } else if (line.trim() === 'dependencies:') {
        inDeps = true
      } else if (inDeps && line.match(/^\s{4}"?([^"]+)"?\s/u)) {
        const m = line.match(/^\s{4}"?([^"]+)"?\s/u)
        if (m) deps.push(m[1])
      } else if (inDeps && !line.startsWith(' ')) {
        inDeps = false
      }
    }
    if (currentPkg !== null) edges.set(currentPkg, [...deps])
  } else {
    // yarn-berry: basic key parse
    const lines = content.split('\n')
    let currentPkg: string | null = null
    let inDeps = false
    const deps: string[] = []
    for (const line of lines) {
      if (line.match(/^"[^"]+":$/u) || line.match(/^[^\s"]+:$/u)) {
        if (currentPkg !== null) edges.set(currentPkg, [...deps])
        const keyLine = line.replace(/:$/, '').replace(/"/gu, '')
        // Extract name before first @npm: or @
        const m = keyLine.match(/^(@[^@]+|[^@]+)@/u)
        currentPkg = m ? m[1] : null
        inDeps = false
        deps.length = 0
      } else if (line.trim() === 'dependencies:') {
        inDeps = true
      } else if (inDeps && line.match(/^\s{4}(\S+):/u)) {
        const m = line.match(/^\s{4}(\S+):/u)
        if (m) deps.push(m[1])
      } else if (inDeps && line.trim() === '') {
        inDeps = false
      }
    }
    if (currentPkg !== null) edges.set(currentPkg, [...deps])
  }

  return edges
}

/**
 * BFS from a set of root package names, returning all reachable names.
 * @param {string[]} roots Starting package names.
 * @param {Map<string, string[]>} edges Adjacency map.
 * @returns {Set<string>} All reachable package names including roots.
 */
function bfs(roots: string[], edges: Map<string, string[]>): Set<string> {
  const visited = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (visited.has(name)) continue
    visited.add(name)
    for (const dep of edges.get(name) ?? []) {
      if (!visited.has(dep)) queue.push(dep)
    }
  }
  return visited
}

/**
 * Filters packages to exclude those reachable only via devDependencies.
 * Reads package.json from projectDir to identify prod vs dev roots.
 * Falls back to returning all packages if package.json is unreadable.
 * @param {Package[]} packages All packages from lockfile.
 * @param {string} projectDir Directory containing package.json.
 * @param {string} lockfileContent Raw lockfile content.
 * @param {LockfileType} lockfileType The lockfile format.
 * @returns {Package[]} Filtered package list (dev-only packages removed).
 */
export function filterDevPackages(packages: Package[], projectDir: string, lockfileContent: string, lockfileType: LockfileType): Package[] {
  let pkgJson: PackageJson
  try {
    const raw = readFileSync(join(projectDir, 'package.json'), 'utf8')
    pkgJson = JSON.parse(raw) as PackageJson
  } catch {
    return packages
  }

  const prodRoots = Object.keys(pkgJson.dependencies ?? {})
  const devRoots = Object.keys(pkgJson.devDependencies ?? {})

  const edges = buildEdgeMap(lockfileContent, lockfileType)
  const productionSet = bfs(prodRoots, edges)
  const devReachable = bfs(devRoots, edges)

  // devOnlySet = reachable from dev but NOT from prod
  const devOnlySet = new Set<string>()
  for (const name of devReachable) {
    if (!productionSet.has(name)) devOnlySet.add(name)
  }

  return packages.filter(p => !devOnlySet.has(p.name))
}
```

- [ ] **Step 6: Wire `--no-dev` into `src/cli.ts`**

Add import at top of `src/cli.ts` (after existing imports):

```typescript
import { filterDevPackages } from './graph/index.js'
```

After `resolveLocal` call and before `resolveRegistry`, add:

```typescript
// Pass 1.5: filter dev-only packages if --no-dev
if (values['no-dev']) {
  packages = filterDevPackages(packages, cwd, content, lockfileType)
}
```

- [ ] **Step 7: Run graph tests**

Run: `npm test -- --test-name-pattern "filterDevPackages"` Expected: All 4 graph tests pass.

- [ ] **Step 8: Run full test suite**

Run: `npm test` Expected: All tests pass (40 original + new ones).

- [ ] **Step 9: Commit**

```bash
git add src/graph/index.ts test/graph/index.test.ts test/fixtures/package-graph.json test/fixtures/graph-shared/package.json src/cli.ts
git commit -m "feat(graph): implement --no-dev transitive dependency filtering"
```

---

## Task 6: `.github/workflows/pr-lint.yml` — add `workflow_call`, fix branch

**Files:**

- Modify: `.github/workflows/pr-lint.yml`

- [ ] **Step 1: Update the `on:` block**

Change:

```yaml
on:
  pull_request:
    branches: [master, main]
```

To:

```yaml
on:
  pull_request:
    branches: [main]
  workflow_call: {}
```

This removes `master` (repo only uses `main`) and adds `workflow_call` so `publish.yml` can reuse this job.

- [ ] **Step 2: Verify YAML is valid**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/pr-lint.yml','utf8'))"` in the project root, or visually check indentation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-lint.yml
git commit -m "ci(pr-lint): add workflow_call trigger, remove master branch"
```

---

## Task 7: `.github/workflows/ci.yml` — new CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the file**

Create `.github/workflows/ci.yml`:

```yaml
---
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_call: {}

permissions:
  contents: read

concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          registry-url: 'https://registry.npmjs.org'

      - uses: actions/cache@v4
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('**/package-lock.json') }}

      - run: npm ci

      - run: npm run lint

      - run: npm test

      - run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow with lint, test, and build steps"
```

---

## Task 8: `.github/workflows/publish.yml` — new publish workflow

**Files:**

- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create the file**

Create `.github/workflows/publish.yml`:

```yaml
---
name: Publish

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  pr-lint:
    uses: ./.github/workflows/pr-lint.yml

  publish:
    name: Publish
    runs-on: ubuntu-latest
    needs: [ci, pr-lint]

    permissions:
      contents: write
      issues: write
      pull-requests: write
      id-token: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          always-auth: true
          registry-url: 'https://registry.npmjs.org'
          scope: '@ivuorinen'

      - uses: actions/cache@v4
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('**/package-lock.json') }}

      - run: npm ci

      - run: npm run build

      - uses: cycjimmy/semantic-release-action@v4
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add publish workflow with semantic-release"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test` Expected output: `ℹ pass N` (N ≥ 44), `ℹ fail 0`

- [ ] **Step 2: Run lint**

Run: `npm run lint` Expected: exits 0, no errors or warnings.

- [ ] **Step 3: Run a build**

Run: `npm run build` Expected: `dist/cli.js` produced, exit 0.

- [ ] **Step 4: Smoke test --no-dev flag**

Run: `node dist/cli.js --no-dev --offline` Expected: Runs without error; output shows packages analyzed.

- [ ] **Step 5: Smoke test --all flag**

Run: `node dist/cli.js --all --offline` Expected: Runs without error; output includes "All packages (no constraint declared)" section if any unconstrained packages exist.

---

## Self-Review Checklist

- [x] Bug 1 (pnpm v9): fixture created, parser uses `metaBlock` for engines — covered Task 1
- [x] Bug 2 (showAll): `renderTarget` accepts `allPackages`, renders unconstrained block — covered Task 2
- [x] Bug 3 (cacheDir): field removed from interface and call site — covered Task 3
- [x] Bug 4 (intersection order): sort by minVersion before greedy loop — covered Task 4
- [x] Bug 5 (--no-dev): fully wired via `filterDevPackages` — covered Task 5
- [x] pr-lint.yml: `workflow_call` added, `master` removed — covered Task 6
- [x] ci.yml: new file with `workflow_call` so publish can reuse it — covered Task 7
- [x] publish.yml: calls ci + pr-lint, uses `GITHUB_TOKEN` not PAT — covered Task 8
- [x] All existing 40 tests must still pass — verified in Task 9 step 1
- [x] `renderOutput` signature change propagated to both `cli.ts` and test file — covered Task 2 steps 4 and 5
