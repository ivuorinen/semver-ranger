[![npm version](https://img.shields.io/npm/v/@ivuorinen/semver-ranger)](https://www.npmjs.com/package/@ivuorinen/semver-ranger)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/@ivuorinen/semver-ranger)](https://nodejs.org)

# semver-ranger

Find the safe Node.js and peer dependency version ranges across your entire dependency tree.

## What it does

`semver-ranger` reads your lockfile, fetches `engines` and `peerDependencies` metadata
for every resolved package — from the npm registry or local `node_modules` — and computes
the semver intersection of all constraints across your full dependency tree. It surfaces
conflicts where no safe range exists, and compares your installed versions against the
latest available ones.

Supported lockfile formats: `package-lock.json` (npm), `yarn.lock` (Yarn classic and Berry),
and `pnpm-lock.yaml` (pnpm). The lockfile is auto-detected from the current directory if
no path is provided.

## Why it's useful

Tracing transitive `engines` and peer dependency constraints by hand is impractical once
a project has more than a handful of dependencies. `semver-ranger` does it in one command,
making it useful for deciding which Node.js version to target, validating that a new package
won't break your peer dependency setup, and running constraint checks in CI.

## Install

The quickest way is to run it without installing:

```sh
npx @ivuorinen/semver-ranger
```

For frequent use, install globally:

```sh
npm install -g @ivuorinen/semver-ranger
```

## Usage

```sh
semver-ranger [lockfile-path] [options]
```

Run from your project directory to auto-detect the lockfile, or pass a path explicitly.

| Option | Description |
|---|---|
| `--offline` | Skip registry lookups; use `node_modules` and cache only |
| `--check <pkg>` | Add a package to peer dependency analysis (repeatable) |
| `--no-dev` | Exclude devDependencies from analysis |
| `--all` | Show all packages, including those with no constraints |
| `--json` | Output raw JSON instead of tables |
| `--version` | Print version and exit |
| `--help` | Print usage and exit |

Exit codes: `0` success, `1` unrecoverable error.

## Example output

```
semver-ranger — package-lock.json (npm) — 214 packages analyzed
────────────────────────────────────────────────────────────────────────────────
node  (engines)  ·  6 packages declare a constraint

  Package                      Installed    Latest       Range
  typescript                   5.4.5        5.6.3        >=4.7
  tsx                          4.19.2       4.19.2       >=18.0.0
  esbuild                      0.21.5       0.24.0       >=12.0.0
  flat-cache                   6.0.0        6.1.4        >=18
  env-paths                    4.0.0        4.0.0        >=18
  semver                       7.6.3        7.6.3        >=10.0.0

  Safe range (installed):       >=18
  Safe range (latest):          >=18

────────────────────────────────────────────────────────────────────────────────
react  (peerDependencies)  ·  3 packages declare a constraint

  Package                      Installed    Latest       Range
  @testing-library/react       16.0.0       16.3.0       ^18.0.0 || ^19.0.0
  react-dom                    18.3.1       19.1.0       ^18 || ^19
  some-legacy-lib              2.4.1        3.0.0        ^16 || ^17

  Safe range (installed):       ⚠  conflict — no safe range
  Safe range (latest):          ⚠  conflict — no safe range

  ⚠  Conflicts at latest (1 package(s) block upgrade):
  ⚠  some-legacy-lib           2.4.1        3.0.0        ^16 || ^17
```

---

## How it works

`semver-ranger` runs a four-step pipeline. First, it detects or accepts a lockfile path and
parses all resolved packages from it. Second, it resolves `engines` and `peerDependencies`
metadata for each package — checking local `node_modules` first, then querying the npm
registry (responses are stored in a flat-file cache so repeated runs are fast). Third, it
computes the semver intersection of all constraints for each analysis target (the Node.js
engine, or a specific peer package). Finally, it renders the result as an ASCII table or
JSON.

## Requirements

- Node.js 22 or later
- `nvm` is recommended to activate the correct version: `nvm use`

## Development

Clone the repository and install dependencies:

```sh
git clone https://github.com/ivuorinen/semver-ranger.git
cd semver-ranger
npm install
```

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` via tsup (ESM) |
| `npm run dev` | Watch mode compilation |
| `npm run lint` | Prettier format + ESLint auto-fix |
| `npm run test` | Run tests with Node's native test runner |
| `npm run cov` | Test coverage (experimental) |

## Architecture

```
src/
  cli.ts          Entry point — argument parsing and pipeline orchestration
  types.ts        Shared TypeScript type definitions
  analyzer/       Semver intersection logic for engines and peer constraints
  parsers/        Lockfile parsers: npm, yarn-classic, yarn-berry, pnpm, auto-detect
  registry/       npm registry client and local node_modules fallback
  graph/          Dependency graph traversal and devDependency filtering
  cache/          flat-cache wrapper for registry responses
  output/         CLI table and JSON rendering
```

Tests live in `test/`, mirroring the `src/` structure. Fixtures for each lockfile format
are in `test/fixtures/`. The test runner is Node's built-in `node --test` with `tsx/esm`
for TypeScript support — no Jest or Vitest.

## License

MIT — [Ismo Vuorinen](https://github.com/ivuorinen)
