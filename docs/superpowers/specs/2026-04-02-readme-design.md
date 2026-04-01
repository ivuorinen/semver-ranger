# README Design Spec — semver-ranger

**Date:** 2026-04-02 **Scope:** Create `README.md` from scratch

---

## Audience

Two audiences, served by a single file (Option A — user-first, contributor-appended):

- **Users** — developers who want to run the tool against their project
- **Contributors** — developers who want to build, test, or extend the tool

---

## Structure

### 1. Badges

A single row of shields:

- License: MIT
- npm version: `@ivuorinen/semver-ranger`
- Node.js: `>=22`

### 2. Title + Tagline

```
# semver-ranger
```

One sentence: find the safe Node.js and peer dependency version ranges across your entire dependency tree.

### 3. What it does

3–4 sentences covering:

- Reads a lockfile (auto-detected or path-specified)
- Fetches `engines` and `peerDependencies` for every resolved package (registry or local `node_modules`)
- Computes the semver intersection of all constraints
- Surfaces conflicts where no safe range exists
- Supported lockfile formats: npm (`package-lock.json`), Yarn classic and Berry (`yarn.lock`), pnpm (`pnpm-lock.yaml`)

### 4. Why it's useful

2–3 sentences: manual tracing of transitive `engines`/peer constraints is impractical at scale; this tool does it in one command. Useful for CI checks, Node.js version targeting, and peer dep audits.

### 5. Install

Lead with `npx` (zero-install, primary):

```
npx @ivuorinen/semver-ranger
```

Global install as alternative for frequent use:

```
npm install -g @ivuorinen/semver-ranger
```

### 6. Usage

```
semver-ranger [lockfile-path] [options]
```

Flag reference table:

| Flag            | Description                                            |
| --------------- | ------------------------------------------------------ |
| `--offline`     | Skip registry; use `node_modules` + cache only         |
| `--check <pkg>` | Add a package to peer dep analysis (repeatable)        |
| `--no-dev`      | Exclude devDependencies from analysis                  |
| `--all`         | Show all packages, including those with no constraints |
| `--json`        | Output raw JSON instead of tables                      |
| `--version`     | Print version and exit                                 |
| `--help`        | Print usage and exit                                   |

Exit codes: `0` success, `1` unrecoverable error.

### 7. Example output

A representative ASCII table showing:

- A few packages with engine ranges
- The computed intersection row
- At least one conflict row (with a clear visual distinction)

Source: construct a plausible example from the `AnalysisTarget` type and output shape. Do not fabricate real package names if unclear — use realistic placeholders.

### 8. How it works

4 sentences covering the pipeline:

1. Detect or accept a lockfile path; parse all resolved packages
2. Resolve `engines` and `peerDependencies` metadata — local `node_modules` first, then npm registry (responses are flat-file cached)
3. Compute the semver intersection of all constraints for each target (Node.js engine, peer package)
4. Render as an ASCII table or JSON

### 9. Requirements

- Node.js 22+
- `nvm` recommended

### 10. Development setup

```
git clone https://github.com/ivuorinen/semver-ranger.git
cd semver-ranger
npm install
```

Commands table:

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `npm run build` | Compile TypeScript to `dist/` via tsup (ESM) |
| `npm run dev`   | Watch mode compilation                       |
| `npm run lint`  | Prettier format + ESLint auto-fix            |
| `npm run test`  | Run tests with Node's native test runner     |
| `npm run cov`   | Test coverage (experimental)                 |

### 11. Architecture

Annotated `src/` directory tree:

```
src/
  cli.ts          Entry point — argument parsing and orchestration
  types.ts        Shared TypeScript type definitions
  analyzer/       Semver intersection logic (engines, peers, conflicts)
  parsers/        Lockfile parsers: npm, yarn-classic, yarn-berry, pnpm, auto-detect
  registry/       npm registry client + local node_modules fallback
  graph/          Dependency graph traversal and dev-package filtering
  cache/          flat-cache wrapper for registry responses
  output/         CLI table rendering
```

### 12. License

MIT — Ismo Vuorinen

---

## Tone

- No emoji
- Pleasant and direct
- Written for a developer audience; no need to over-explain semver or lockfiles
- Present tense for descriptions ("reads", "computes", not "will read", "will compute")

---

## Files to create

- `README.md` at repo root

## Files not to create

- `CONTRIBUTING.md` (content lives in README)
- Any other documentation files
