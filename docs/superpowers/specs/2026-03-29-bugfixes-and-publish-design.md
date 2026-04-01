# semver-ranger — Bug Fixes, --no-dev Graph Traversal, and Publish Workflow

**Date:** 2026-03-29 **Status:** Approved

---

## Context

Five bugs were found during code review of the current implementation. Additionally, the project has no CI or publish workflow. This spec covers fixing all five bugs (including implementing the previously-dead `--no-dev` flag via transitive dependency graph traversal) and adding two GitHub Actions workflows for CI and publishing.

---

## Section 1: Bug Fixes

### Bug 1 — pnpm v9 engine data silently dropped

**File:** `src/parsers/pnpm.ts`

**Problem:** The parser iterates `lock.snapshots ?? lock.packages`. In pnpm v9, `snapshots` is present but does not contain `engines` or `peerDependencies` — only `packages` does. When `snapshots` exists, engine data is silently missing.

**Fix:** Always iterate `packages` for metadata (engines, peerDependencies). Use `snapshots` only when `packages` is absent (pnpm v6 fallback). The loop becomes:

```typescript
const metaBlock = lock.packages ?? {}
const versionBlock = lock.snapshots ?? lock.packages ?? {}
```

Iterate `versionBlock` for name/version extraction; look up `metaBlock[key]` for engines/peerDeps.

---

### Bug 2 — `showAll` is a no-op in `renderTarget`

**File:** `src/output/table.ts`

**Problem:** `renderTarget(target, showAll)` does `void showAll` — the parameter is accepted but never used. Running with `--all` shows no additional packages.

**Fix:** When `showAll` is true, after the constrained-packages section, add a block:

```
  All packages (no constraint declared):
    pkg-a    1.0.0    2.0.0    —
    pkg-b    3.1.0    3.2.0    —
```

`renderOutput` must also receive the full `packages: Package[]` list and pass it through to `renderTarget` so it can diff against `target.ranges`.

Function signature change:

```typescript
renderOutput(targets, totalPackages, packages, lockfileName, manager, showAll, json)
renderTarget(target, allPackages, showAll)
```

---

### Bug 3 — Vestigial `cacheDir` in `ResolveOptions`

**Files:** `src/registry/client.ts`, `src/cli.ts`

**Problem:** `ResolveOptions` has a `cacheDir: string` field that is passed as `''` from the CLI but ignored inside the client, which calls `getCacheDir()` directly.

**Fix:** Remove `cacheDir` from `ResolveOptions`. Remove the field from the call site in `cli.ts`.

---

### Bug 4 — Intersection algorithm is order-dependent

**File:** `src/analyzer/intersect.ts`

**Problem:** The greedy loop checks each new range against the accumulated `combined` string. Whether a range is flagged as a conflict depends on the order packages appear. For example, with `>=14 <18`, `>=20`, `>=16 <21`:

- Order A: `>=14 <18` ∩ `>=20` = ∅ → `>=20` flagged, `>=16 <21` never checked
- Order B: `>=14 <18` ∩ `>=16 <21` = `>=16 <18`, then `>=16 <18` ∩ `>=20` = ∅ → `>=20` correctly flagged

The algorithm misses conflicts that appear later in the list.

**Fix:** Run all pairwise intersections to find the globally compatible subset. Concrete algorithm:

1. Start with `validRanges = valid` (filtered, non-wildcard)
2. For each pair `(i, j)`, check `semver.intersects(ranges[i].range, ranges[j].range)`
3. A range is in conflict if it does not intersect with ANY other range in the set
4. The intersection is computed from the compatible subset

Simpler practical fix that avoids O(n²): sort ranges from tightest upper bound to loosest before the greedy pass. Use `semver.minVersion` of each range as the sort key (ascending). This gives a deterministic, reproducible conflict set.

---

### Bug 5 — `--no-dev` flag is declared but never wired

Addressed in Section 2.

---

## Section 2: `--no-dev` — Transitive Dev Dependency Filtering

### New module: `src/graph/index.ts`

A standalone module that builds a dependency graph from a lockfile and filters out packages reachable only via devDependencies.

#### Public API

```typescript
export function filterDevPackages(packages: Package[], projectDir: string, lockfileContent: string, lockfileType: LockfileType): Package[]
```

#### Internal: `buildEdgeMap`

```typescript
function buildEdgeMap(content: string, type: LockfileType): Map<string, string[]>
```

Returns a map from package name to list of direct dependency names (not versioned — just names). Format-specific logic:

| Format       | Edge source                                     |
|--------------|-------------------------------------------------|
| npm v3       | `packages["node_modules/X"].dependencies` keys  |
| npm v1       | `dependencies["X"].requires` keys               |
| pnpm v6/v9   | `packages["/X@ver"].dependencies` keys          |
| yarn classic | `object["X@^range"].dependencies` keys          |
| yarn berry   | `parseSyml()["X@npm:^range"].dependencies` keys |

#### Algorithm

1. Read `package.json` from `projectDir`:
    - `prodRoots = Object.keys(dependencies ?? {})`
    - `devRoots = Object.keys(devDependencies ?? {})`
2. Call `buildEdgeMap(content, type)` to get the graph
3. BFS from `prodRoots` → `productionSet: Set<string>`
4. BFS from `devRoots` → `devOnlySet: Set<string>` (subtract productionSet)
5. Filter: keep packages where `name ∈ productionSet || name ∉ devOnlySet`

If `package.json` is not found or unreadable, return `packages` unchanged (fail open — safe default).

#### CLI wiring (`src/cli.ts`)

After `resolveLocal`, before `resolveRegistry`:

```typescript
if (values['no-dev']) {
  packages = filterDevPackages(packages, cwd, content, lockfileType)
}
```

`--help` text updated: `--no-dev   Exclude devDependencies and their transitive packages from analysis`

#### Tests

`test/graph/index.test.ts` — uses existing fixtures plus extended versions with `dependencies` blocks. Tests cover:

- npm v3 graph traversal
- pnpm graph traversal
- Packages shared between prod and dev are retained
- Packages exclusively in dev are excluded
- Missing `package.json` returns packages unchanged

---

## Section 3: CI/CD Workflows

### `.github/workflows/ci.yml`

Runs on every push and pull_request targeting `main`. Provides fast feedback and validates that lint, tests, and build all pass.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

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
      - uses: actions/checkout@...
      - uses: actions/setup-node@...
        with:
          node-version-file: '.nvmrc'
          registry-url: 'https://registry.npmjs.org'
      - uses: actions/cache@...
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('**/package-lock.json') }}
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@...
        with:
          name: dist
          path: dist/
```

### `.github/workflows/pr-lint.yml` (modified)

Add `workflow_call` to the existing triggers so `publish.yml` can call it directly:

```yaml
on:
  pull_request:
    branches: [main]
  workflow_call: {} # ← add this; no inputs needed
```

**Why this never runs twice:** `pull_request` fires only when a PR is opened or updated — it does not fire on a push to `main`. `workflow_call` from `publish.yml` fires only on push to `main`. The two paths are mutually exclusive; there is no scenario where both triggers fire for the same commit.

### `.github/workflows/publish.yml`

Runs on push to `main` only. Requires CI and pr-lint to pass first. Runs semantic-release to determine if a release is warranted and publishes to npm.

```yaml
name: Publish

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ci:
    uses: ./.github/workflows/ci.yml # reuse via workflow_call

  pr-lint:
    uses: ./.github/workflows/pr-lint.yml # reuse via workflow_call

  publish:
    name: Publish
    runs-on: ubuntu-latest
    needs: [ci, pr-lint]
    permissions:
      contents: write # create GitHub release + push CHANGELOG.md
      issues: write # comment on released issues
      pull-requests: write # comment on released PRs
      id-token: write # npm provenance via OIDC

    steps:
      - uses: actions/checkout@...
        with:
          fetch-depth: 0 # semantic-release needs full git history
      - uses: actions/setup-node@...
        with:
          node-version-file: '.nvmrc'
          always-auth: true
          registry-url: 'https://registry.npmjs.org'
          scope: '@ivuorinen'
      - uses: actions/cache@...
        with:
          path: node_modules
          key: node-modules-${{ hashFiles('**/package-lock.json') }}
      - run: npm ci
      - run: npm run build # dist/cli.js must exist before npm publish
      - uses: cycjimmy/semantic-release-action@...
        # No extra_plugins needed — @ivuorinen/semantic-release-config
        # already declares: commit-analyzer, release-notes-generator,
        # changelog, npm, github, git
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Why `GITHUB_TOKEN` (not PAT):** `@semantic-release/git` pushes the CHANGELOG commit back to `main`. `GITHUB_TOKEN` has `contents: write` permission and is sufficient. Pushes via `GITHUB_TOKEN` do not re-trigger workflows, which prevents an infinite publish loop.

**Required secrets:** `NPM_TOKEN` only.

### Workflow reuse

Both `ci.yml` and `pr-lint.yml` use the `workflow_call` trigger so `publish.yml` can reference them directly. `publish.yml`'s `publish` job waits for both to succeed before releasing.

---

## File Map

```
Modified:
  src/parsers/pnpm.ts              ← Bug 1: pnpm v9 engine data
  src/output/table.ts              ← Bug 2: --all rendering + signature
  src/registry/client.ts           ← Bug 3: remove cacheDir
  src/cli.ts                       ← Bug 3 callsite + --no-dev wiring
  src/analyzer/intersect.ts        ← Bug 4: deterministic conflict detection
  .github/workflows/pr-lint.yml    ← add workflow_call trigger

Created:
  src/graph/index.ts               ← --no-dev graph traversal
  test/graph/index.test.ts
  .github/workflows/ci.yml
  .github/workflows/publish.yml
```

---

## Testing

All existing 40 tests must continue to pass. New tests added:

| File                              | Covers                                                                               |
|-----------------------------------|--------------------------------------------------------------------------------------|
| `test/graph/index.test.ts`        | npm/pnpm graph traversal, prod/dev split, shared deps retained, missing package.json |
| `test/parsers/pnpm.test.ts`       | Extended: v9 engine data now present                                                 |
| `test/analyzer/intersect.test.ts` | Extended: order-independence verified                                                |
| `test/output/table.test.ts`       | Extended: `--all` produces rows for unconstrained packages                           |

Workflow files are not unit-tested. Manual verification: push a `fix:` commit to main after merging and confirm semantic-release creates a patch release.
