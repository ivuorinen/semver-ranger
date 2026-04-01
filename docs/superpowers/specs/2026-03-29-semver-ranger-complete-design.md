# semver-ranger — Complete Implementation Design

**Date:** 2026-03-29 **Status:** Approved

---

## Context

semver-ranger is a CLI tool that parses lock files to help developers plan Node.js and tooling upgrade paths. The primary use case: given a project's lock file, determine what the minimum and maximum Node version (and other runtime/tooling requirements) all dependencies collectively require — so the user knows what's safe to upgrade to.

The project currently has a partial CJS implementation. This spec covers converting it to TypeScript, implementing all parsing logic, adding registry-backed upgrade path analysis, and a rich cliui-based output.

---

## CLI Interface

```
semver-ranger [lockfile-path] [options]
```

`lockfile-path` is optional. If omitted, searches cwd in priority order: `package-lock.json` → `pnpm-lock.yaml` → `yarn.lock`

### Flags

| Flag            | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `--offline`     | Skip registry; use node_modules + cache only                           |
| `--check <pkg>` | Add a package to peer dep analysis (repeatable)                        |
| `--no-dev`      | Exclude devDependencies from analysis                                  |
| `--all`         | Show all packages including those with no engines/peer dep declaration |
| `--json`        | Output raw JSON instead of tables                                      |
| `--version`     | Print version (sourced from package.json) and exit                     |
| `--help`        | Print usage and exit                                                   |

**Exit codes:** `0` success (conflicts are informational), `1` unrecoverable error.

---

## Architecture

### Module Layout

```
src/
  cli.ts              ← arg parsing, pipeline orchestration (no business logic)
  types.ts            ← shared interfaces
  parsers/
    detect.ts         ← auto-detect lockfile, walk up from cwd
    npm.ts            ← package-lock.json (v1/v2/v3, raw JSON)
    yarn-classic.ts   ← yarn.lock classic via @yarnpkg/lockfile
    yarn-berry.ts     ← yarn.lock berry via @yarnpkg/parsers
    pnpm.ts           ← pnpm-lock.yaml via @pnpm/lockfile-file
  registry/
    local.ts          ← read node_modules/<name>/package.json
    client.ts         ← fetch from registry.npmjs.org (native fetch)
  cache/
    index.ts          ← XDG path resolution + flat-cache wrapper
  analyzer/
    engines.ts        ← intersect semver ranges from engines field
    peers.ts          ← intersect peer dep ranges, auto-detect targets
  output/
    table.ts          ← cliui-based rendering
```

### Pipeline

```
detect lockfile
      ↓
parse lockfile → Package[]
      ↓
resolve data (node_modules + registry) → Package[] with engines + peerDeps
      ↓
analyze → AnalysisTarget[]
      ↓
render (cliui tables) or JSON stdout
```

---

## Shared Types (`src/types.ts`)

```typescript
interface Package {
  name: string
  version: string // currently installed
  latestVersion?: string // from registry (omitted in --offline)
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface AnalysisTarget {
  name: string // e.g. 'node', 'typescript', 'react'
  source: 'engines' | 'peerDependencies'
  ranges: RangeEntry[] // one per package that declares it
  intersection: string | null // computed safe range, null = conflict
  conflicts: RangeEntry[] // entries that break the intersection
}

interface RangeEntry {
  package: string
  version: string
  range: string
}
```

---

## Parsers

Each parser is a **pure function**: `(fileContent: string) => Package[]`. No engines reading, no registry calls, no semver logic inside parsers.

| Lockfile              | Package                                    | Notes                                                    |
| --------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `package-lock.json`   | raw `JSON.parse` + manual TypeScript types | v2/v3: `packages` hash; v1 fallback: `dependencies` hash |
| `yarn.lock` (classic) | `@yarnpkg/lockfile`                        | Detected by absence of `__metadata:`                     |
| `yarn.lock` (berry)   | `@yarnpkg/parsers`                         | Detected by presence of `__metadata:`                    |
| `pnpm-lock.yaml`      | `@pnpm/lockfile-file`                      | `importers` + `packages` blocks                          |

**`package-lock-parser` is removed** — replaced by manual npm lockfile typing.

**Deduplication:** all entries are kept (same package at multiple versions is valid — the analyzer needs the full picture).

---

## Data Resolution

### Pass 1 — Local (`src/registry/local.ts`)

Read `node_modules/<name>/package.json`, extract `engines` and `peerDependencies`. If file missing, mark for registry fallback.

### Pass 2 — Registry (`src/registry/client.ts`)

Skipped entirely if `--offline`. Uses native `fetch()`:

- **Current version:** `https://registry.npmjs.org/<name>/<version>`
- **Latest version:** `https://registry.npmjs.org/<name>/latest`

Concurrency limit: 8 parallel fetches via `Promise.all` with a semaphore.

---

## Cache (`src/cache/index.ts`)

### Path Resolution

1. `$XDG_CACHE_HOME/semver-ranger`
2. Platform default via `env-paths` (`~/.cache/semver-ranger` on Linux, `~/Library/Caches/semver-ranger` on macOS)
3. `npm root -g` + `/.cache/semver-ranger` as last resort

### Stores (via `flat-cache`)

| Store      | Key            | TTL | Rationale                            |
| ---------- | -------------- | --- | ------------------------------------ |
| `versions` | `name@version` | ∞   | Published versions are immutable     |
| `latest`   | `name`         | 24h | Latest tag changes with new releases |

TTL checked manually: `latest` entries store `{ data, cachedAt }`, stale entries are re-fetched.

---

## Analyzer

### `src/analyzer/engines.ts`

- Collects `engines.node` ranges across all packages
- Also collects `engines.<manager>` matching the detected package manager (npm/yarn/pnpm)
- Computes intersection; packages declaring `*` or omitting the field are excluded

### `src/analyzer/peers.ts`

- Reads the **project's own `package.json`** (not the lockfile) for direct deps
- Cross-references against well-known list:
  ```typescript
  const WELL_KNOWN_PEERS = ['typescript', 'react', 'react-dom', 'vue', 'svelte', 'webpack', 'vite', 'rollup', 'esbuild', 'jest', 'vitest', 'next', 'nuxt', 'astro']
  ```
- Merges with `--check` additions from CLI
- For each target, collects all peer dep ranges declared across the dep tree

### Intersection Logic (shared)

Uses `semver` package (already a dep). Iteratively applies `semver.intersects()` across all ranges. Returns `null` if any two ranges are disjoint.

---

## Output (`src/output/table.ts`)

### Default layout (one section per target)

```
semver-ranger — analyzing 247 packages

  Lockfile:   package-lock.json (npm)
  Targets:    node, npm, typescript, react

────────────────────────────────────────────────────────────

  node (engines)                42 of 247 packages declare a constraint
  ─────────────────────────────────────────────────────────
  Safe range (installed):   >=18.0.0 <22.0.0
  Safe range (latest):      >=20.0.0 <24.0.0

  Most restrictive (installed):
    express          4.18.2    >=14.0.0
    some-package     1.0.0     >=18.0.0 <22.0.0   ← upper bound

  ⚠  Conflicts at latest (2 packages would block upgrade):
    legacy-pkg       1.0.0 → 2.0.0    <18.0.0
    old-thing        3.1.0 → 4.0.0    >=10.0.0 <16.0.0
```

**With `--all`:** packages with no declaration shown with `—` in range column. **With `--json`:** bypasses cliui, writes `AnalysisTarget[]` to stdout. **Separator width:** `process.stdout.columns` (fallback 80).

### cliui column layout

- Headers: full-width single `div()`
- Summary rows: two-column `div({text, width: 30}, {text, width: 50})`
- Package detail rows: four-column `div(name, installedVersion, latestVersion, range)`
- Conflict rows: `⚠` prefix, same four-column layout

---

## TypeScript Setup

**Bundler:** `tsup` (esbuild-based)

**`tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**`tsup.config.ts`:**

```typescript
export default {
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false
}
```

**`package.json` updates:**

```json
{
  "type": "module",
  "bin": { "semver-ranger": "dist/cli.js" },
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "eslint --fix .",
    "test": "node --import tsx/esm --test 'test/**/*.test.ts'"
  }
}
```

### Dependency changes

**Add (direct):** `env-paths`, `flat-cache`, `@yarnpkg/lockfile`, `@yarnpkg/parsers`, `@pnpm/lockfile-file` **Add (devDep):** `typescript`, `tsup`, `tsx` **Remove:** `package-lock-parser`

---

## Testing

**Runner:** Node built-in `node --test` (no extra dep, ships with Node 22)

```
test/
  parsers/
    npm.test.ts
    yarn-classic.test.ts
    yarn-berry.test.ts
    pnpm.test.ts
    detect.test.ts
  analyzer/
    engines.test.ts
    peers.test.ts
  cache/
    index.test.ts
  registry/
    client.test.ts
  fixtures/
    package-lock.json
    yarn-classic.lock
    yarn-berry.lock
    pnpm-lock.yaml
    package.json
```

### Coverage by module

| Module            | Test focus                                                                         |
| ----------------- | ---------------------------------------------------------------------------------- |
| Parsers           | Correct `Package[]` from fixtures; yarn classic/berry detection                    |
| `detect.ts`       | Lockfile found from directory; priority order respected                            |
| `engines.ts`      | Intersection correct; `null` for disjoint; `*` ignored                             |
| `peers.ts`        | Auto-detect from fixture `package.json`; `--check` merges correctly                |
| `cache`           | Miss triggers fetch; hit skips fetch; TTL expiry re-fetches; versions never expire |
| `registry/client` | Registry calls mocked; `--offline` skips all fetches                               |

Registry calls are **always mocked** — no network in the test suite.
