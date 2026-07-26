[![npm version][npm-badge]][npm-url]
[![License: MIT][license-badge]][license-url] [![Node.js][node-badge]][node-url]

[npm-badge]: https://img.shields.io/npm/v/@ivuorinen/semver-ranger
[npm-url]: https://www.npmjs.com/package/@ivuorinen/semver-ranger
[license-badge]: https://img.shields.io/badge/License-MIT-blue.svg
[license-url]: LICENSE
[node-badge]: https://img.shields.io/node/v/@ivuorinen/semver-ranger
[node-url]: https://nodejs.org

# semver-ranger

Find the safe Node.js and peer dependency version ranges across your entire
dependency tree.

## What it does

`semver-ranger` reads your lockfile, fetches `engines` and `peerDependencies`
metadata for every resolved package — from the npm registry or local
`node_modules` — and computes the semver intersection of all constraints across
your full dependency tree. It surfaces conflicts where no safe range exists, and
compares your installed versions against the latest available ones.

Supported lockfile formats: `package-lock.json` (npm), `yarn.lock` (Yarn classic
and Berry), and `pnpm-lock.yaml` (pnpm). The lockfile is auto-detected from the
current directory if no path is provided.

## Why it's useful

Tracing transitive `engines` and peer dependency constraints by hand is
impractical once a project has more than a handful of dependencies.
`semver-ranger` does it in one command, making it useful for deciding which
Node.js version to target, validating that a new package won't break your peer
dependency setup, and running constraint checks in CI.

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

Run from your project directory to auto-detect the lockfile, or pass a path
explicitly.

| Option          | Description                                              |
| --------------- | -------------------------------------------------------- |
| `--offline`     | Skip registry lookups; use `node_modules` and cache only |
| `--check <pkg>` | Add a package to peer dependency analysis (repeatable)   |
| `--no-dev`      | Exclude devDependencies from analysis                    |
| `--all`         | Show all packages, including those with no constraints   |
| `--json`        | Output raw JSON instead of tables                        |
| `--version`     | Print version and exit                                   |
| `--help`        | Print usage and exit                                     |

Exit codes: `0` success, `1` unrecoverable error.

## Example output

```text
semver-ranger — analyzing 7 packages

Lockfile:     package-lock.json (npm)
Targets:      node, react

────────────────────────────────────────────────────────────────────────────────

  node (engines)   4 package(s) declare a constraint
  ────────────────────────────────────────────────────────────────────────────
Safe node range (installed):    >=20.19.0 <21.0.0-0 || >=22.13.0 <23.0.0-0 ||
                                >=24.0.0
Safe node range (latest):       >=20.19.0 <21.0.0-0 || >=22.13.0 <23.0.0-0 ||
                                >=24.0.0

  Most restrictive (installed):
Package                     Installed   Latest      Range
typescript                  5.4.5       5.6.3       >=14.17
tsx                         4.19.2      4.19.2      >=18.0.0
flat-cache                  6.1.4       6.1.4       >=18
ora                         9.4.1       9.4.1       ^20.19.0 || ^22.13.0
                                                    || >=24
────────────────────────────────────────────────────────────────────────────────

  react (peerDependencies)   3 package(s) declare a constraint
  ────────────────────────────────────────────────────────────────────────────
Safe react range (installed):    >=18.3.1 <19.0.0-0
Safe react range (latest):       ⚠  conflict — no safe range

  Most restrictive (installed):
Package                     Installed   Latest      Range
@testing-library/react      16.0.0      16.3.0      ^18.0.0 || ^19.0.0
react-dom                   18.3.1      19.1.0      ^18.3.1
some-legacy-lib             2.4.1       3.0.0       ^17.0.0 || ^18.0.0

  ⚠  Conflicts at latest (1 package(s) block upgrade):
⚠  some-legacy-lib         2.4.1       3.0.0       ^16.0.0 || ^17.0.0
────────────────────────────────────────────────────────────────────────────────
```

Table widths adapt to your terminal. When a lookup cannot be resolved, or a
declared range is not valid semver, that is reported explicitly rather than
folded into the result — an unresolved constraint would otherwise make the
computed range look safer than it is.

### Private registries and proxies

Registry lookups honour npm's own configuration. When the tool is run through
`npm exec` / `npx`, npm exports the resolved `.npmrc` as `npm_config_*`
environment variables, so a mirror (`registry=`) and per-scope registries
(`@acme:registry=`) are picked up automatically.

Node only routes `fetch` through `HTTP_PROXY` / `HTTPS_PROXY` when it is started
with proxy support enabled, and that cannot be turned on from inside a running
process. Behind a proxy, run:

```sh
NODE_USE_ENV_PROXY=1 npx @ivuorinen/semver-ranger
```

The tool warns when a proxy is configured but not in use, rather than letting
every lookup fail silently.

---

## How it works

`semver-ranger` runs a four-step pipeline. First, it detects or accepts a
lockfile path and parses all resolved packages from it. Second, it resolves
`engines` and `peerDependencies` metadata for each package — checking local
`node_modules` first, then querying the npm registry (responses are stored in a
flat-file cache so repeated runs are fast). Third, it computes the semver
intersection of all constraints for each analysis target (the Node.js engine, or
a specific peer package). Finally, it renders the result as an ASCII table or
JSON.

## Requirements

- Node.js 24 or later (matches the `engines.node` field in `package.json`)
- `nvm` is recommended to activate the correct version: `nvm use`

## Development

Clone the repository and install dependencies:

```sh
git clone https://github.com/ivuorinen/semver-ranger.git
cd semver-ranger
npm install
```

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/` via tsup (ESM) |
| `npm run dev`       | Watch mode compilation                       |
| `npm run lint`      | Check formatting and lint rules (no writes)  |
| `npm run lint:fix`  | Apply Prettier and ESLint auto-fixes         |
| `npm run typecheck` | Type-check with `tsc --noEmit`               |
| `npm run test`      | Run tests with Node's native test runner     |
| `npm run cov`       | Test coverage (experimental)                 |

## Architecture

```text
src/
  cli.ts          Entry point — argument parsing and pipeline orchestration
  types.ts        Shared TypeScript type definitions
  analyzer/       Semver intersection logic for engines and peer constraints
  parsers/        Lockfile parsers: npm, yarn classic/berry, pnpm, detect
  registry/       npm registry client and local node_modules fallback
  graph/          Dependency graph traversal and devDependency filtering
  cache/          flat-cache wrapper for registry responses
  output/         CLI table and JSON rendering
```

Tests live in `test/`, mirroring the `src/` structure. Fixtures for each
lockfile format are in `test/fixtures/`. The test runner is Node's built-in
`node --test` with `tsx/esm` for TypeScript support — no Jest or Vitest.

## License

MIT — [Ismo Vuorinen](https://github.com/ivuorinen)
