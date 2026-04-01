# MegaLinter CI Fixes — Design

**Date:** 2026-04-01 **Status:** Approved

## Context

PR #74 (`feat!: rewrite in TypeScript`) fails MegaLinter CI. 7 linter categories have errors; 1 has warnings. All are fixable in-code or in-config — no suppressions.

## Failing Linters & Root Causes

| Linter | Count | Root cause |
| --- | --- | --- |
| `ts-standard` | many | `strict-boolean-expressions`, `restrict-template-expressions`, spacing/indent |
| `jscpd` | 5 clones | Repeated fetch-mock blocks in test files |
| `editorconfig-checker` | 17 lines | `CLAUDE.md` exceeds `max_line_length = 80` for `*.md` |
| `npm-package-json-lint` | 1 | `test/fixtures/graph-shared/package.json` missing `"version"` |
| `kics` | 1 | `publish.yml:50` action not pinned to full SHA |
| `grype` + `trivy` | 4 CVEs | `test/fixtures/package-lock.json` has `express@4.18.2`, `body-parser@1.20.1` |
| `yaml/prettier` (warning) | 2 | `.prettierrc.json` extends `@ivuorinen/prettier-config` (not installed) |

---

## Fix Plan

### Fix 1 — ts-standard: run auto-fixer, then fix semantic errors

**Step 1 — auto-fix formatting:** Run `npx ts-standard --fix` once. This resolves `space-before-function-paren`, `indent`, and similar style issues across all source files automatically. Then run `npm run lint` to verify no conflict with the project's ESLint config.

**Step 2 — manual semantic fixes** in affected files:

| File | Violations | Fix pattern |
| --- | --- | --- |
| `src/analyzer/engines.ts:14,31` | nullable string in boolean | `if (x)` → `if (x != null)` |
| `src/analyzer/intersect.ts:26-28,37` | nullable obj/any in boolean | `if (x)` → `if (x != null)` |
| `src/analyzer/peers.ts:69,73` | nullable string in boolean | `if (x)` → `if (x != null)` |
| `src/cache/index.ts:13` | any in boolean | `if (x)` → `if (x != null)` |
| `src/cli.ts:37,42,72,74,89,124` | any/nullable in boolean | `if (x)` → `if (x != null)` |
| `src/cli.ts:75,92` | `string\|undefined` in template | `\`${x}\`` → `\`${x ?? ''}\`` |
| `src/graph/index.ts:85` | nullable obj in boolean | `if (x)` → `if (x != null)` |
| `src/output/table.ts:4` | any in boolean (`columns \|\| 80`) | `columns > 0 ? columns : 80` |
| `src/output/table.ts:37,179` | string in boolean (`x \|\| '—'`) | `x !== '' ? x : '—'` |
| `src/parsers/detect.ts:26` | any in boolean | `if (x)` → `if (x != null)` |
| `src/parsers/npm.ts:41` | nullable string in boolean | `if (x)` → `if (x != null)` |

**Commit:** `fix(ts): make boolean conditions explicit for ts-standard`

---

### Fix 2 — jscpd: extract shared test helpers

**Clones identified:**

1. `test/registry/client.test.ts` lines 62–68 ≈ lines 120–126 — fetch mock returning a manifest
2. `test/registry/client.test.ts` lines 95–101 ≈ lines 146–152 — fetch mock returning latest
3. `test/parsers/npm.test.ts` lines 13–21 ≈ lines 22–30 — two nearly-identical fixture objects

**Fix:** In each file, extract the repeated block to a named helper at file scope:

- `client.test.ts`: `function makeManifestMock(engines, peerDeps)` and `function makeLatestMock(version)` — called from each test that needs a mock
- `npm.test.ts`: A `buildFixture(name, version, ...rest)` object factory

No new files; helpers live at the top of the same test file.

**Commit:** `test: extract repeated mock helpers to eliminate jscpd clones`

---

### Fix 3 — editorconfig: add CLAUDE.md override

`CLAUDE.md` contains tables and long URLs that cannot wrap to 80 chars. The `.editorconfig` already has a `max_line_length = 3000` override for `.github/**/*.md`. Add a matching override for `CLAUDE.md`:

```ini
[CLAUDE.md]
max_line_length = off
```

**Commit:** `chore: exempt CLAUDE.md from editorconfig line-length rule`

---

### Fix 4 — npm-package-json-lint: add version to fixture

`test/fixtures/graph-shared/package.json` is missing the required `version` field. Add `"version": "1.0.0"` (a dummy version is sufficient for a test fixture).

**Commit:** `test: add missing version field to graph-shared fixture`

---

### Fix 5 — kics: pin GitHub Action to full SHA

`publish.yml:50` uses `cycjimmy/semantic-release-action@v4`. Pin it to its current full SHA.

Look up the SHA with:

```bash
gh api repos/cycjimmy/semantic-release-action/git/refs/tags/v4 --jq '.object.sha'
```

If the tag points to a tag object (not a commit), dereference:

```bash
gh api repos/cycjimmy/semantic-release-action/git/tags/<SHA> --jq '.object.sha'
```

Replace `@v4` with `@<full-sha> # v4` in `publish.yml`.

**Commit:** `ci: pin semantic-release-action to full commit SHA`

---

### Fix 6 — grype + trivy: update test fixture dependencies

`test/fixtures/package-lock.json` uses vulnerable versions:

- `express@4.18.2` — CVE-2024-29041, CVE-2024-43796; fix in `4.19.2`
- `body-parser@1.20.1` — CVE-2024-45590 (HIGH); fix in `1.20.3`

Update the fixture file to reference `4.19.2` and `1.20.3` respectively. This file is only used in parser tests; no production code is affected.

**Commit:** `test: bump vulnerable express and body-parser in fixture lockfile`

---

### Fix 7 — yaml/prettier: install missing prettier config package

`.prettierrc.json` contains `{ "extends": "@ivuorinen/prettier-config" }` but the package is not installed. Install it as a devDependency:

```bash
npm install --save-dev @ivuorinen/prettier-config
```

This resolves both YAML and JSON prettier warnings in one shot.

**Commit:** `chore: install missing @ivuorinen/prettier-config devDependency`

---

## Commit Sequence

1. `fix(ts): make boolean conditions explicit for ts-standard`
2. `test: extract repeated mock helpers to eliminate jscpd clones`
3. `chore: exempt CLAUDE.md from editorconfig line-length rule`
4. `test: add missing version field to graph-shared fixture`
5. `ci: pin semantic-release-action to full commit SHA`
6. `test: bump vulnerable express and body-parser in fixture lockfile`
7. `chore: install missing @ivuorinen/prettier-config devDependency`

---

## Verification

```bash
npm run lint    # zero errors
npm test        # 90+ tests pass
npm run build   # compiles cleanly
```

Push to `feat/complete-rewrite` — all 7 MegaLinter linters should pass.
