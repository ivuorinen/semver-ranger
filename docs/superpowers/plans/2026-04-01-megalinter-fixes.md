# MegaLinter CI Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 7 failing MegaLinter linters on PR #74 so CI passes green.

**Architecture:** Seven independent commits, each targeting one linter category. Task 1 (ts-standard) runs the auto-fixer first to eliminate formatting noise, then fixes semantic violations by hand. Tasks 2–7 are single-file or single-command changes with no dependencies between them.

**Tech Stack:** Node.js 22+, TypeScript, ts-standard, jscpd, editorconfig-checker, npm-package-json-lint, kics, grype, trivy, prettier

---

### Task 1: Fix ts-standard violations

**Files:**

- Modify: `src/analyzer/engines.ts`
- Modify: `src/analyzer/intersect.ts`
- Modify: `src/analyzer/peers.ts`
- Modify: `src/cache/index.ts`
- Modify: `src/cli.ts`
- Modify: `src/graph/index.ts`
- Modify: `src/output/table.ts`
- Modify: `src/parsers/detect.ts`
- Modify: `src/parsers/npm.ts`

- [ ] **Step 1: Run the ts-standard auto-fixer**

```bash
cd /Users/ivuorinen/Code/ivuorinen/semver-ranger
npx ts-standard --fix
```

This resolves `space-before-function-paren`, `indent`, `explicit-function-return-type`, and similar style issues automatically. Do NOT commit yet.

- [ ] **Step 2: Verify auto-fix didn't break tests**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ pass 90` (or higher), `ℹ fail 0`.

- [ ] **Step 3: Fix `src/analyzer/engines.ts` — nullable string in boolean**

Current lines 13–14:

```typescript
const range = pkg.engines?.[key]
if (range && range !== '*') {
```

Replace with:

```typescript
const range = pkg.engines?.[key]
if (range != null && range !== '*') {
```

Current lines 30–31:

```typescript
const range = pkg.latestEngines?.[key]
if (range && range !== '*') {
```

Replace with:

```typescript
const range = pkg.latestEngines?.[key]
if (range != null && range !== '*') {
```

- [ ] **Step 4: Fix `src/analyzer/intersect.ts` — nullable object in boolean**

Current sort comparator (lines 26–29):

```typescript
if (!minA && !minB) return 0
if (!minA) return 1
if (!minB) return -1
return semver.compare(minA, minB)
```

Replace with:

```typescript
if (minA == null && minB == null) return 0
if (minA == null) return 1
if (minB == null) return -1
return semver.compare(minA, minB)
```

Current line 37:

```typescript
if (!semver.intersects(combined, entry.range)) {
```

Replace with:

```typescript
if (semver.intersects(combined, entry.range) === false) {
```

- [ ] **Step 5: Fix `src/analyzer/peers.ts` — nullable string in boolean**

Current lines 68–69:

```typescript
const range = pkg.peerDependencies?.[targetName]
if (range && range !== '*') {
```

Replace with:

```typescript
const range = pkg.peerDependencies?.[targetName]
if (range != null && range !== '*') {
```

Current lines 72–73:

```typescript
const latestRange = pkg.latestPeerDependencies?.[targetName]
if (latestRange && latestRange !== '*') {
```

Replace with:

```typescript
const latestRange = pkg.latestPeerDependencies?.[targetName]
if (latestRange != null && latestRange !== '*') {
```

- [ ] **Step 6: Fix `src/cache/index.ts` — string in boolean**

Current lines 12–13:

```typescript
const xdg = process.env.XDG_CACHE_HOME
if (xdg) return join(xdg, 'semver-ranger')
```

Replace with:

```typescript
const xdg = process.env.XDG_CACHE_HOME
if (xdg != null && xdg !== '') return join(xdg, 'semver-ranger')
```

- [ ] **Step 7: Fix `src/cli.ts` — any/nullable values in boolean**

Current line 37:

```typescript
if (values.version) {
```

Replace with:

```typescript
if (values.version === true) {
```

Current line 42:

```typescript
if (values.help) {
```

Replace with:

```typescript
if (values.help === true) {
```

Current line 72:

```typescript
if (lockfilePath) {
```

Replace with:

```typescript
if (lockfilePath != null) {
```

Current line 124 (`if (values['no-dev'])`):

```typescript
if (values['no-dev']) {
```

Replace with:

```typescript
if (values['no-dev'] === true) {
```

Note: After fixing line 72, the nullable-cascade errors on lines 74 (`existsSync`), 75 (template literal), 89 (ternary), and 92 (template literal) should resolve automatically because TypeScript now narrows `lockfilePath` to `string` inside the `if` block.

- [ ] **Step 8: Fix `src/graph/index.ts` — nullable object in boolean**

Current line 85:

```typescript
if (m) deps.push(m[1])
```

Replace with:

```typescript
if (m != null) deps.push(m[1])
```

- [ ] **Step 9: Fix `src/output/table.ts` — any/string in boolean**

Current line 4:

```typescript
const WIDTH = process.stdout.columns || 80
```

Replace with:

```typescript
const WIDTH =
  process.stdout.columns != null && process.stdout.columns > 0
    ? process.stdout.columns
    : 80
```

Current line 37 (inside `renderPackageRow`):

```typescript
{ text: latestVersion || '—', width: COL_LATEST },
```

Replace with:

```typescript
{ text: latestVersion !== '' ? latestVersion : '—', width: COL_LATEST },
```

For the string-in-boolean in `renderOutput` (the `|| 'none'` for targets list, around line 179):

```typescript
{ text: targets.map(t => t.name).join(', ') || 'none', width: 60 }
```

Replace with:

```typescript
{ text: targets.length > 0 ? targets.map(t => t.name).join(', ') : 'none', width: 60 }
```

- [ ] **Step 10: Fix `src/parsers/detect.ts` — any in boolean**

`existsSync` calls may be flagged if ts-standard cannot infer the return type properly. Check all three `if (existsSync(...))` calls (lines 26, 31, 36) and cast explicitly if needed:

```typescript
// Before
if (existsSync(npmPath)) {

// After (only if ts-standard still flags it after auto-fix step)
if (existsSync(npmPath) === true) {
```

Apply the same pattern to `existsSync(pnpmPath)` and `existsSync(yarnPath)` if flagged.

- [ ] **Step 11: Fix `src/parsers/npm.ts` — nullable string in boolean**

Current line 41:

```typescript
if (!name || !entry.version) continue
```

Replace with:

```typescript
if (name == null || entry.version == null) continue
```

- [ ] **Step 12: Verify no remaining ts-standard errors**

```bash
npx ts-standard 2>&1 | grep -v "npm warn"
```

Expected: no output (zero errors).

- [ ] **Step 13: Run full test suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ pass 90` (or higher), `ℹ fail 0`.

- [ ] **Step 14: Commit**

```bash
git add src/analyzer/engines.ts src/analyzer/intersect.ts src/analyzer/peers.ts \
  src/cache/index.ts src/cli.ts src/graph/index.ts src/output/table.ts \
  src/parsers/detect.ts src/parsers/npm.ts
git commit -m "$(cat <<'EOF'
fix(ts): make boolean conditions explicit for ts-standard

Replace implicit truthiness checks with explicit null comparisons and
strict equality to satisfy @typescript-eslint/strict-boolean-expressions
and @typescript-eslint/restrict-template-expressions.
EOF
)"
```

---

### Task 2: Eliminate jscpd copy-paste clones

**Files:**

- Modify: `test/registry/client.test.ts`
- Modify: `test/parsers/npm.test.ts`

- [ ] **Step 1: Identify all 5 clones**

```bash
cd /Users/ivuorinen/Code/ivuorinen/semver-ranger
npx jscpd --min-lines 4 --threshold 0 'test/**/*.ts' 2>&1 | grep "Clone found" -A3
```

Note the exact line ranges. The known clones are:

- `client.test.ts` lines 62–68 ≈ lines 120–126 (fetch mock with both manifest+latest)
- `client.test.ts` lines 95–101 ≈ lines 146–152 (fetch mock returning one payload)
- `npm.test.ts` lines 13–21 ≈ lines 22–30 (parse + assert express version)

- [ ] **Step 2: Add fetch mock helpers to `test/registry/client.test.ts`**

Add these three helper functions at the top of the file, after the imports (before the `describe('registry client', ...)`):

```typescript
type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

/** Returns a mock fetch that serves `manifest` for version requests and `latest` for /latest. */
function makeDualFetch(
  manifest: Record<string, unknown>,
  latest: Record<string, unknown>
): FetchFn {
  return async input => {
    const url = String(input)
    if (url.includes('/latest')) {
      return { ok: true, json: async () => latest } as Response
    }
    return { ok: true, json: async () => manifest } as Response
  }
}

/** Returns a mock fetch that always responds with ok:false (simulates network error). */
function makeFailFetch(): FetchFn {
  return async () => ({ ok: false, json: async () => ({}) }) as Response
}
```

Then replace each repeated block with a call to these helpers. For example, in the `fetchManifest: cache miss + fetch ok` test (around line 46):

```typescript
// Before:
;(globalThis as Record<string, unknown>).fetch = async (
  input: string | URL | Request
) => {
  const url = String(input)
  if (url.includes('/latest')) {
    return {
      ok: true,
      json: async () => ({ version: '2.0.0' })
    } as Response
  }
  return {
    ok: true,
    json: async () => ({
      engines: { node: '>=18' }
    })
  } as Response
}

// After:
globalThis.fetch = makeDualFetch(
  { engines: { node: '>=18' } },
  { version: '2.0.0' }
)
```

Apply the same replacement for all identical blocks. For tests that return a single payload (no `/latest` branch), use:

```typescript
globalThis.fetch = async () =>
  ({ ok: true, json: async () => ({ version: '3.0.0' }) }) as Response
```

For fail cases:

```typescript
globalThis.fetch = makeFailFetch()
```

- [ ] **Step 3: Add parse helper to `test/parsers/npm.test.ts`**

Add this helper after the imports (before `describe('parseNpmLockfile', ...)`):

```typescript
/** Parses a lockfile and asserts there is at least one package named express at the given version. */
function assertExpressVersion(
  fixtureFile: string,
  expectedVersion: string
): void {
  const content = readFileSync(join(fixturesDir, fixtureFile), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express)
  assert.strictEqual(express.version, expectedVersion)
}
```

Replace the two `parses v3 lockfile` and `parses v1 lockfile` test bodies:

```typescript
// Before (v3 test):
it('parses v3 lockfile', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express)
  assert.strictEqual(express.version, '4.18.2')
})

// After:
it('parses v3 lockfile', () => {
  assertExpressVersion('package-lock.json', '4.18.2')
})
```

```typescript
// Before (v1 test):
it('parses v1 lockfile', () => {
  const content = readFileSync(
    join(fixturesDir, 'package-lock-v1.json'),
    'utf8'
  )
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express)
  assert.strictEqual(express.version, '4.18.2')
})

// After:
it('parses v1 lockfile', () => {
  assertExpressVersion('package-lock-v1.json', '4.18.2')
})
```

Note: after updating the fixture in Task 6, change `'4.18.2'` → `'4.19.2'` in these calls.

- [ ] **Step 4: Verify jscpd passes**

```bash
npx jscpd --min-lines 4 --threshold 0 'test/**/*.ts' 2>&1 | grep "ERROR\|Found"
```

Expected: no ERROR line, no clones found (or fewer than the threshold).

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/registry/client.test.ts test/parsers/npm.test.ts
git commit -m "$(cat <<'EOF'
test: extract repeated mock helpers to eliminate jscpd clones

Extract makeDualFetch/makeFailFetch helpers in client.test.ts and
assertExpressVersion in npm.test.ts to remove the 5 duplicate blocks
flagged by jscpd.
EOF
)"
```

---

### Task 3: Fix editorconfig — CLAUDE.md line length

**Files:**

- Modify: `.editorconfig`

- [ ] **Step 1: Add CLAUDE.md override**

Open `.editorconfig`. After the `[{*.markdown,*.md}]` section (which ends at the `trim_trailing_whitespace = false` line), add:

```ini
[CLAUDE.md]
max_line_length = off
```

The end of `.editorconfig` should read:

```ini
[{*.markdown,*.md}]
max_line_length = 80
trim_trailing_whitespace = false

[CLAUDE.md]
max_line_length = off

[.github/**/{*.markdown,*.md,*.yml}]
max_line_length = 3000
```

- [ ] **Step 2: Verify editorconfig-checker passes**

```bash
npx editorconfig-checker CLAUDE.md 2>&1 | grep -v "npm warn"
```

Expected: no output (zero errors).

- [ ] **Step 3: Commit**

```bash
git add .editorconfig
git commit -m "$(cat <<'EOF'
chore: exempt CLAUDE.md from editorconfig line-length rule

CLAUDE.md contains tables and URLs that cannot wrap to 80 chars.
Add a per-file override (max_line_length = off), mirroring the
existing .github/**/*.md override.
EOF
)"
```

---

### Task 4: Fix npm-package-json-lint — missing version in fixture

**Files:**

- Modify: `test/fixtures/graph-shared/package.json`

- [ ] **Step 1: Add version field**

Current content of `test/fixtures/graph-shared/package.json`:

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

Replace with:

```json
{
  "name": "graph-shared-test",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "typescript": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Verify**

```bash
npx --yes npm-package-json-lint test/fixtures/graph-shared/package.json 2>&1 | grep -v "npm warn"
```

Expected: no errors.

- [ ] **Step 3: Run tests to confirm fixture change doesn't break anything**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ fail 0`.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/graph-shared/package.json
git commit -m "$(cat <<'EOF'
test: add missing version field to graph-shared fixture

npm-package-json-lint requires a version field in package.json files.
EOF
)"
```

---

### Task 5: Fix kics — pin GitHub Action to full SHA

**Files:**

- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Resolve the full commit SHA for cycjimmy/semantic-release-action v4**

```bash
gh api repos/cycjimmy/semantic-release-action/git/ref/tags/v4 --jq '.object.sha, .object.type'
```

If the output type is `tag` (annotated tag), dereference it:

```bash
gh api repos/cycjimmy/semantic-release-action/git/tags/<SHA-FROM-ABOVE> --jq '.object.sha'
```

The final SHA should be a 40-character hex string (a commit SHA, not a tag SHA).

- [ ] **Step 2: Update publish.yml line 49**

Current:

```yaml
- uses: cycjimmy/semantic-release-action@v4
```

Replace with (substituting `<FULL-SHA>` with the 40-char SHA from Step 1):

```yaml
- uses: cycjimmy/semantic-release-action@<FULL-SHA> # v4
```

Example (verify this is still correct at time of execution):

```yaml
- uses: cycjimmy/semantic-release-action@b1b432f819e8d2aed9d5e05bff4d9918bde3b044 # v4
```

- [ ] **Step 3: Verify YAML is valid**

```bash
npx js-yaml .github/workflows/publish.yml > /dev/null && echo "valid"
```

Expected: `valid`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "$(cat <<'EOF'
ci: pin semantic-release-action to full commit SHA

kics requires GitHub Actions to be pinned to a full-length commit SHA
to prevent supply chain attacks. Pin cycjimmy/semantic-release-action@v4
to its resolved SHA while keeping the v4 tag as a comment.
EOF
)"
```

---

### Task 6: Fix grype/trivy — update vulnerable fixture dependencies

**Files:**

- Modify: `test/fixtures/package-lock.json`

- [ ] **Step 1: Update express from 4.18.2 to 4.19.2**

In `test/fixtures/package-lock.json`, find the `node_modules/express` entry:

```json
"node_modules/express": {
  "version": "4.18.2",
  "resolved": "https://registry.npmjs.org/express/-/express-4.18.2.tgz",
  "engines": {
    "node": ">= 0.10.0"
  }
},
```

Replace with:

```json
"node_modules/express": {
  "version": "4.19.2",
  "resolved": "https://registry.npmjs.org/express/-/express-4.19.2.tgz",
  "engines": {
    "node": ">= 0.10.0"
  }
},
```

Also update the root `dependencies` entry if it references an exact version:

```json
"": {
  "name": "test-project",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
```

Change `"express": "^4.18.2"` to `"express": "^4.19.2"`.

- [ ] **Step 2: Update body-parser from 1.20.1 to 1.20.3**

Find the `node_modules/body-parser` entry:

```json
"node_modules/body-parser": {
  "version": "1.20.1",
  "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-1.20.1.tgz",
```

Replace with:

```json
"node_modules/body-parser": {
  "version": "1.20.3",
  "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-1.20.3.tgz",
```

- [ ] **Step 3: Update npm.test.ts express version assertion**

In `test/parsers/npm.test.ts`, the tests now assert `express.version === '4.18.2'`. Update them to `'4.19.2'`:

```typescript
// Before:
it('parses v3 lockfile', () => {
  assertExpressVersion('package-lock.json', '4.18.2')
})
it('parses v1 lockfile', () => {
  assertExpressVersion('package-lock-v1.json', '4.18.2')
})

// After:
it('parses v3 lockfile', () => {
  assertExpressVersion('package-lock.json', '4.19.2')
})
```

Note: `package-lock-v1.json` likely has its own version string — check and update separately if it also has express. `package-lock-v1.json` is a separate fixture file; only update express version references in `package-lock.json` (v3).

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ fail 0`. If any parser test now fails with "expected 4.18.2 but got 4.19.2", update the assertion to match.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/package-lock.json test/parsers/npm.test.ts
git commit -m "$(cat <<'EOF'
test: bump vulnerable express and body-parser in fixture lockfile

express@4.18.2 has CVE-2024-29041 (open redirect) fixed in 4.19.2.
body-parser@1.20.1 has CVE-2024-45590 (HIGH, ReDoS) fixed in 1.20.3.
These are test fixtures only; no production code is affected.
EOF
)"
```

---

### Task 7: Fix yaml/prettier — install missing prettier config package

**Files:**

- Modify: `package.json` (via npm install)
- Modify: `package-lock.json` (via npm install)

- [ ] **Step 1: Install @ivuorinen/prettier-config**

```bash
cd /Users/ivuorinen/Code/ivuorinen/semver-ranger
npm install --save-dev @ivuorinen/prettier-config
```

If the package is not found on npm (private/unpublished), use this fallback instead — replace `.prettierrc.json` with an inline config:

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "none"
}
```

- [ ] **Step 2: Verify prettier can now resolve its config**

```bash
npx prettier --check .github/workflows/ci.yml 2>&1 | grep -v "npm warn"
```

Expected: `All matched files use Prettier code style!` (or zero errors).

- [ ] **Step 3: Run full lint + tests**

```bash
npm run lint 2>&1 | tail -5
npm test 2>&1 | tail -5
```

Expected: no lint errors, `ℹ fail 0`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: install missing @ivuorinen/prettier-config devDependency

.prettierrc.json extends @ivuorinen/prettier-config but the package
was not installed, causing yaml/prettier warnings in MegaLinter CI.
EOF
)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Confirm all 7 commits are present**

```bash
git log --oneline -10
```

Expected (most recent first):

```
<hash> chore: install missing @ivuorinen/prettier-config devDependency
<hash> test: bump vulnerable express and body-parser in fixture lockfile
<hash> ci: pin semantic-release-action to full commit SHA
<hash> test: add missing version field to graph-shared fixture
<hash> chore: exempt CLAUDE.md from editorconfig line-length rule
<hash> test: extract repeated mock helpers to eliminate jscpd clones
<hash> fix(ts): make boolean conditions explicit for ts-standard
```

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test 2>&1 | tail -5
```

Expected: `ℹ fail 0`.

- [ ] **Step 3: Run npm run lint**

```bash
npm run lint 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Run npm run build**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean compile, no errors.

- [ ] **Step 5: Push to trigger MegaLinter CI**

```bash
git push origin feat/complete-rewrite
```

Then monitor: `gh run list --branch feat/complete-rewrite --limit 3`
