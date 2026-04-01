# TypeScript Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the complete JavaScript→TypeScript rewrite as 7 atomic semantic commits on branch `feat/complete-rewrite`.

**Architecture:** Each commit captures one distinct concern of the migration, staged explicitly by file/path. The gitignore fix happens first so `tsx-501/` never touches any commit. Old JS files (`index.js`, `lib/parser.js`) are removed in the same commit that adds `src/`.

**Tech Stack:** git, conventional commits (semantic), HEREDOC commit messages

---

### Task 1: Add tsx-501 to .gitignore

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add `tsx-501/` to .gitignore**

Open `.gitignore`. After the `node-compile-cache` line (currently the last non-blank line, ~line 136), add:

```
tsx-501/
```

The end of `.gitignore` should read:

```
node-compile-cache
tsx-501/
```

- [ ] **Step 2: Verify tsx-501 is now ignored**

```bash
git status --short
```

Expected: `tsx-501/` no longer appears in untracked files. `.gitignore` shows as `M .gitignore`.

- [ ] **Step 3: Stage and commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore: add tsx-501 to gitignore

tsx-501/ is the tsx runtime cache directory, auto-generated on every
test run. It should never be committed.
EOF
)"
```

---

### Task 2: Commit GitHub community files and workflow updates

**Files:**

- Stage: `.github/CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/workflows/pr-lint.yml`, `.github/workflows/stale.yml`, `.github/workflows/sync-labels.yml`

- [ ] **Step 1: Stage the files**

```bash
git add \
  .github/CODE_OF_CONDUCT.md \
  .github/ISSUE_TEMPLATE/bug_report.md \
  .github/ISSUE_TEMPLATE/feature_request.md \
  .github/workflows/pr-lint.yml \
  .github/workflows/stale.yml \
  .github/workflows/sync-labels.yml
```

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected — exactly these 6 files:

```
.github/CODE_OF_CONDUCT.md
.github/ISSUE_TEMPLATE/bug_report.md
.github/ISSUE_TEMPLATE/feature_request.md
.github/workflows/pr-lint.yml
.github/workflows/stale.yml
.github/workflows/sync-labels.yml
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: update github community files and workflow configs
EOF
)"
```

---

### Task 3: Commit new CI and publish workflows

**Files:**

- Stage: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`

- [ ] **Step 1: Stage the files**

```bash
git add \
  .github/workflows/ci.yml \
  .github/workflows/publish.yml
```

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected — exactly these 2 files:

```
.github/workflows/ci.yml
.github/workflows/publish.yml
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
ci: add ci and publish workflows
EOF
)"
```

---

### Task 4: Commit build tooling migration

**Files:**

- Stage: `package.json`, `package-lock.json`, `tsconfig.json`, `tsup.config.ts`, `eslint.config.mjs`, `.prettierrc.json`

- [ ] **Step 1: Stage the files**

```bash
git add \
  package.json \
  package-lock.json \
  tsconfig.json \
  tsup.config.ts \
  eslint.config.mjs \
  .prettierrc.json
```

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected — exactly these 6 files:

```
.prettierrc.json
eslint.config.mjs
package-lock.json
package.json
tsconfig.json
tsup.config.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: migrate build tooling to typescript

Switch entry point to dist/cli.js, add tsup for bundling,
tsconfig for strict ESM TypeScript, prettier for formatting,
and update eslint config for TypeScript source.
EOF
)"
```

---

### Task 5: Commit the TypeScript rewrite (remove old JS, add src/)

**Files:**

- Stage (add): `src/`
- Stage (delete): `index.js`, `lib/parser.js`

- [ ] **Step 1: Stage src/ and the deletions**

```bash
git add src/
git add index.js lib/parser.js
```

Note: `index.js` and `lib/parser.js` are already deleted on disk (staged as `D` in git status). `git add` on a deleted file stages the removal.

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected: `src/` files (many entries) plus:

```
index.js          ← deletion
lib/parser.js     ← deletion
```

No `test/`, `CLAUDE.md`, or `docs/` files should appear.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat!: rewrite implementation in typescript

Replace index.js + lib/parser.js with a full TypeScript rewrite
under src/. Entry point is src/cli.ts (compiled to dist/cli.js).

BREAKING CHANGE: drops CommonJS; package is now ESM-only and
requires Node.js 22+.
EOF
)"
```

---

### Task 6: Commit the test suite

**Files:**

- Stage: `test/`

- [ ] **Step 1: Stage test/**

```bash
git add test/
```

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected: only `test/` files. No other directories.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: add test suite

Full test coverage for parsers, analyzer, registry, graph,
cache, and output modules using Node's native test runner
with tsx/esm loader.
EOF
)"
```

---

### Task 7: Commit documentation

**Files:**

- Stage: `CLAUDE.md`, `docs/`

- [ ] **Step 1: Stage CLAUDE.md and docs/**

```bash
git add CLAUDE.md docs/
```

- [ ] **Step 2: Verify staged files**

```bash
git diff --cached --name-only
```

Expected: `CLAUDE.md` and all files under `docs/`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: add claude.md and project documentation

Add CLAUDE.md with project commands, architecture, and key patterns.
Add superpowers design specs and implementation plans.
EOF
)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Confirm all 7 commits landed**

```bash
git log --oneline -8
```

Expected (most recent first):

```
<hash> docs: add claude.md and project documentation
<hash> test: add test suite
<hash> feat!: rewrite implementation in typescript
<hash> chore: migrate build tooling to typescript
<hash> ci: add ci and publish workflows
<hash> chore: update github community files and workflow configs
<hash> chore: add tsx-501 to gitignore
<hash> docs: add typescript migration design spec   ← already committed
```

- [ ] **Step 2: Confirm working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 3: Confirm tsx-501 is absent from all commits**

```bash
git log --all --full-history -- tsx-501/
```

Expected: no output (tsx-501 never entered any commit).
