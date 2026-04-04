# Build Hardening & CLI Progress Indication

## Context

Running `node dist/index.js` hit a `require is not defined` error from a stale CJS build artifact. The current build (`dist/cli.js`) is correct ESM, but dependencies are not bundled — leaving the CLI vulnerable to CJS/ESM mismatches at runtime. Additionally, the CLI shows **zero output** during execution (1–5 minutes for large projects), making it appear frozen.

This design addresses both issues: bundle all dependencies for runtime safety, and add ora-based progress spinners so the user knows what's happening.

## Goals

1. **Build hardening** — bundle all dependencies into a single ESM file via tsup
2. **Progress indication** — show spinner/progress for each CLI phase using ora

## Non-goals

- Adding a `--quiet` / `--silent` flag (can be added later if needed)
- Rewriting the batch concurrency model in registry client
- Adding color themes or customizable output

---

## Design

### 1. Build Hardening (`tsup.config.ts`)

Add `noExternal: [/.*/]` to bundle all npm dependencies. Node built-ins are excluded by default by tsup/esbuild (imports starting with `node:` are preserved).

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false,
  noExternal: [/.*/]
})
```

**Effect**: Produces a single self-contained `dist/cli.js`. All npm dependency code is inlined as ESM by the bundler, eliminating CJS/ESM runtime compatibility issues. esbuild handles CJS-to-ESM conversion for packages like `@yarnpkg/lockfile` and `semver`.

**Validation required**: After building, verify that CJS-only deps (`@yarnpkg/lockfile`, `semver`, `yaml`) are correctly converted. If any fail, they can be added to an `external` list and left as runtime imports. The build step in Verification covers this.

**`createRequire` note**: The `createRequire(import.meta.url)` call in `cli.ts` for reading `package.json` will remain in the bundled output. This is expected and correct — it uses Node's built-in `module` package. The bundled output will contain exactly one `require()` call (for `package.json`).

### 2. Progress Module (`src/output/progress.ts`)

New module providing ora-based progress helpers. The module uses a single pattern: the CLI creates progress objects and calls their methods directly. No callbacks needed at this layer.

```ts
import ora from 'ora'

interface PhaseSpinner {
  succeed: (text?: string) => void
  fail: (text?: string) => void
  update: (text: string) => void
}

interface BatchProgress {
  update: (text: string) => void
  succeed: (text?: string) => void
}

export function createPhaseSpinner(label: string): PhaseSpinner
export function createBatchProgress(label: string, total: number): BatchProgress
```

**TTY guard**: When `!process.stderr.isTTY`, both functions return no-op stubs. This ensures clean output in pipes, CI, and redirected stderr.

**All output goes to stderr**, keeping stdout clean for `--json` and piped usage. The `--json` flag does NOT suppress spinners — spinners go to stderr, JSON goes to stdout. Users wanting no spinner output should redirect stderr (`2>/dev/null`).

#### `createPhaseSpinner(label)`

- Starts an ora spinner with the given label
- `succeed(text?)` — stops spinner with checkmark
- `fail(text?)` — stops spinner with cross
- `update(text)` — changes spinner text mid-phase

#### `createBatchProgress(label, total)`

- Starts an ora spinner showing `"label... 0/total"`
- `update(text)` — sets spinner text to the provided string (caller formats progress display)
- `succeed(text?)` — stops with checkmark and final stats

### 3. Registry Client Changes (`src/registry/client.ts`)

Extend `ResolveOptions` with an optional progress callback:

```ts
interface ResolveOptions {
  offline: boolean
  onProgress?: (completed: number, total: number, cached: number) => void
}
```

**Changes to `resolveRegistry()`**:

- Track `completedCount` and `cachedCount` as running totals
- After each `processBatch()` completes, increment `completedCount` by `batch.length` (not the constant `CONCURRENCY`, since the final batch may be smaller)
- Call `onProgress(completedCount, total, cachedCount)` after each batch

**Cache hit tracking via mutable counter**:

Pass a `{ cached: number }` counter object into `processBatch`, which forwards it to `fetchManifest` and `fetchLatest`. Each function increments `counter.cached` when `getVersionData()` or `getLatestData()` returns non-null (cache hit). This avoids inference and keeps tracking explicit.

```ts
// In fetchManifest:
const cached = getVersionData(cacheKey)
if (cached !== null) {
  counter.cached++
  return cached
}

// In fetchLatest:
const cached = getLatestData(name)
if (cached !== null) {
  counter.cached++
  return cached
}
```

### 4. CLI Integration (`src/cli.ts`)

Wire progress into `main()`:

| Phase            | Spinner text                        | Type           |
| ---------------- | ----------------------------------- | -------------- |
| Lockfile parsing | `Parsing {basename}...`             | phase spinner  |
| Local resolution | `Reading local packages...`         | phase spinner  |
| Registry lookup  | `Fetching registry data... N/total` | batch progress |
| Dev filtering    | _(too fast, skip)_                  | —              |
| Analysis         | _(too fast, skip)_                  | —              |

**Registry phase wiring**:

The CLI creates a `BatchProgress` and passes an `onProgress` callback that delegates to the progress object:

```ts
const progress = createBatchProgress('Fetching registry data', packages.length)

packages = await resolveRegistry(packages, {
  offline: values.offline ?? false,
  onProgress: (completed, _total, cached) => {
    // Update the spinner text directly with current stats
    progress.update(`Fetching registry data... ${completed}/${packages.length}` + (cached > 0 ? ` (${cached} cached)` : ''))
  }
})

progress.succeed()
```

**Offline mode**: When `--offline` is true, skip the registry spinner entirely (cache-only resolution is near-instant).

### 5. Dependencies

Add `ora` as a production dependency:

```
npm install ora
```

Since tsup bundles everything, ora and its transitive deps (chalk, cli-cursor, cli-spinners, etc.) are inlined into the output.

Remove `src/typings/cliui.d.ts` only if `npm run build` succeeds without it (bundler resolves cliui's types from `node_modules`). If the build fails, keep it.

---

## Files to Modify

| File                     | Change                                            |
| ------------------------ | ------------------------------------------------- |
| `tsup.config.ts`         | Add `noExternal: [/.*/]`                          |
| `package.json`           | Add `ora` to dependencies                         |
| `src/output/progress.ts` | **New** — ora wrapper module                      |
| `src/registry/client.ts` | Add `onProgress` callback + mutable cache counter |
| `src/cli.ts`             | Wire spinners for each phase                      |
| `src/typings/cliui.d.ts` | Remove if build succeeds without it               |

## Verification

1. **Build**: `npm run build` — produces single `dist/cli.js` with no external npm imports (node: built-in imports are expected)
2. **CJS deps**: Verify `@yarnpkg/lockfile`, `semver`, and `yaml` are correctly bundled by running the CLI against a real lockfile
3. **Run**: `node dist/cli.js` — shows spinners during execution
4. **JSON mode**: `node dist/cli.js --json 2>/dev/null` — clean JSON on stdout
5. **Pipe**: `node dist/cli.js | head` — no spinner garbage in stdout
6. **Offline**: `node dist/cli.js --offline` — skips registry spinner
7. **Tests**: `npm test` — all existing tests pass
8. **Bundle check**: Verify the `createRequire('../package.json')` call is the only `require()` in the output: `grep -c "require(" dist/cli.js` should be exactly 1
