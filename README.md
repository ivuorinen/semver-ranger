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

Supported lockfile formats: `package-lock.json` and `npm-shrinkwrap.json` (npm),
`yarn.lock` (Yarn classic and Berry), and `pnpm-lock.yaml` (lockfile version 6
or later, from pnpm 8). The lockfile is auto-detected from the current directory
if no path is provided. When both npm files exist, `npm-shrinkwrap.json` is
analysed, as npm installs from it.

## When to use it

Tracing transitive `engines` and peer dependency constraints by hand stops
working once a project has more than a handful of dependencies. Use
`semver-ranger` to:

- pick the Node.js version to target
- check that a new package fits your peer dependency setup
- run constraint checks in CI (see [JSON output](#json-output))

## Install

Run it without installing:

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

| Option          | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `--offline`     | Skip registry lookups; use the lockfile, `node_modules` and the cache only |
| `--check <pkg>` | Add a package to peer dependency analysis (repeatable)                     |
| `--no-dev`      | Analyze only what a production install includes                            |
| `--all`         | Show packages with no constraints too (table output only)                  |
| `--json`        | Output JSON instead of tables (see [JSON output](#json-output))            |
| `--version`     | Print version and exit                                                     |
| `--help`        | Print usage and exit                                                       |

Exit codes: `0` success, `1` unrecoverable error, `130` interrupted (SIGINT),
`143` terminated (SIGTERM). Both signals save the cache first. Conflicts,
unresolved lookups and skipped packages are results, not errors, and exit `0`:
to fail CI on them, read the [JSON output](#json-output).

Engine targets are always `node` and the package manager that wrote the
lockfile. Peer targets are the frameworks and build tools listed in
[`src/analyzer/peers.ts`](src/analyzer/peers.ts) that the project's
`package.json` names in `dependencies` or `devDependencies`, plus each `--check`
package. Peer detection reads `package.json`; when it is unusable, only
`--check` packages are analysed.

`--no-dev` keeps what your package manager installs with `npm ci --omit=dev`,
`pnpm install --prod`, `yarn install --production` or
`yarn workspaces focus --all --production`. That includes optional dependencies
and the production dependencies of every workspace. npm and pnpm lockfiles
record which packages are dev-only, so they need nothing else. Yarn lockfiles do
not: with either Yarn version, the project's `package.json` and every workspace
member's must parse, or the run exits with code `1`. Yarn Classic also installs
a dev dependency that a production package names as a peer. `yarn.lock` records
no peers, so they come from `node_modules`, the registry or the cache; only an
`--offline` run with none of these misses such a package.

## Example output

```text
semver-ranger — analyzing 7 packages

  Lockfile:   package-lock.json (npm)
  Targets:    node, react

────────────────────────────────────────────────────────────────────────────────

  node (engines)   4 package(s) declare a constraint
  ────────────────────────────────────────────────────────────────────────────
  Safe node range (installed):  >=20.19.0 <21.0.0-0 || >=22.13.0 <23.0.0-0 ||
                                >=24.0.0
  Safe node range (latest):     >=20.19.0 <21.0.0-0 || >=22.13.0 <23.0.0-0 ||
                                >=24.0.0

  Declared constraints (installed):
  Package                   Installed   Latest      Range
  typescript                5.4.5       5.6.3       >=14.17
  tsx                       4.19.2      4.19.2      >=18.0.0
  flat-cache                6.1.4       6.1.4       >=18
  ora                       9.4.1       9.4.1       ^20.19.0 || ^22.13.0
                                                    || >=24
────────────────────────────────────────────────────────────────────────────────

  react (peerDependencies)   3 package(s) declare a constraint
  ────────────────────────────────────────────────────────────────────────────
  Safe react range (installed):  >=18.3.1 <19.0.0-0
  Safe react range (latest):     ⚠  conflict — no safe range

  Declared constraints (installed):
  Package                   Installed   Latest      Range
  @testing-library/react    16.0.0      16.3.0      ^18.0.0 || ^19.0.0
  react-dom                 18.3.1      19.1.0      ^18.3.1
  some-legacy-lib           2.4.1       3.0.0       ^17.0.0 || ^18.0.0

  ⚠  Conflicts at latest (1 package(s) block upgrade):
  ⚠  some-legacy-lib        2.4.1       3.0.0       ^16.0.0 || ^17.0.0
────────────────────────────────────────────────────────────────────────────────
```

Table widths adapt to your terminal. When a lookup cannot be resolved, or a
declared range is not valid semver, that is reported explicitly rather than
folded into the result — an unresolved constraint would otherwise make the
computed range look safer than it is.

### JSON output

With `--json`, stdout is one object:
`{ "targets": [...], "unresolved": [...], "skipped": 0, "latestUncached": 0 }`.
`targets` has one entry per analysed constraint (`node`, the package manager,
each peer target), with its ranges, intersections and conflicts at the installed
and latest versions. `unresolved` lists lookups whose constraints are unknown,
each as `{ "name", "version", "reason" }`, where `version` is `latest` for the
latest-release lookup. `skipped` counts packages not looked up because the
registry stopped responding. `latestUncached` counts packages with no cached
latest data in an `--offline` run. A non-empty `unresolved` or a non-zero
`skipped` means the installed ranges may be too permissive; a non-zero
`latestUncached` means the latest ranges leave packages out. Through 5.x,
`--json` printed the bare `targets` array.

A target has a conflict when its `conflicts` (installed) or `latestConflicts`
list is non-empty. `intersection` is also `null` when no installed version
declares a valid range, so test the lists, not `null`. To fail a CI job on an
installed conflict or an unresolved lookup:

```sh
semver-ranger --json | node -e '
const a = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
const conflict = a.targets.some(t => t.conflicts.length > 0)
process.exit(conflict || a.unresolved.length > 0 ? 1 : 0)'
```

### Private registries and proxies

Registry lookups read `registry=` and per-scope `@acme:registry=` settings from
the project's `.npmrc` and your user `.npmrc`. `npm_config_registry` overrides
the default registry, and `npm_config_userconfig` moves the user `.npmrc`, in
any letter case, as for npm. Global `npmrc` files and `${VAR}` placeholders are
not read. Requests carry no credentials, so a registry that requires them
reports the lookup as failed. Each failed lookup is named with its reason:
`HTTP <status>`, `timeout`, `malformed response` (the registry answered with
something other than a JSON object, such as a proxy's login page), or
`network error: <code>`, for example `ECONNREFUSED` or `ENOTFOUND`. Lookups that
never reach the network report `not from a registry` (a git, tarball, path or
workspace package with no lockfile or `node_modules` data) or `no metadata`
(`--offline`, with nothing cached and no constraints in the lockfile), and a
latest-release answer without a version reports `no version in response`. A
`.npmrc` that exists but cannot be read stops the run with exit code `1` before
any request is sent: skipping it would send private scoped package names to the
default registry.

Packages installed from git, a tarball URL or a local path, and workspace
members, are never looked up: the registry could only fail, or answer for an
unrelated package with the same name. Their constraints come from the lockfile
or `node_modules`, and one with neither is reported as unresolved.

Node only routes `fetch` through `HTTP_PROXY` / `HTTPS_PROXY` when it is started
with proxy support enabled, and that cannot be turned on from inside a running
process. Behind a proxy, run:

```sh
NODE_USE_ENV_PROXY=1 npx @ivuorinen/semver-ranger
```

The tool warns when a proxy is configured but not in use, rather than letting
every lookup fail silently.

### Cache

Registry responses are cached as JSON in `$XDG_CACHE_HOME/semver-ranger` when
that variable is an absolute path. Otherwise they go in
`~/Library/Caches/semver-ranger` on macOS, `%LOCALAPPDATA%\semver-ranger\Cache`
on Windows, and `~/.cache/semver-ranger` elsewhere. Latest-version data expires
after 24 hours. Data for a specific version is kept for up to 50,000 versions,
and the oldest are dropped first beyond that. Deleting the directory is always
safe. `--offline` warns when latest data is not cached for some packages,
because the latest ranges then leave those packages out.

---

## How it works

`semver-ranger` runs a four-step pipeline. First, it detects or accepts a
lockfile path and parses all resolved packages from it. Second, it resolves
`engines` and `peerDependencies` metadata for each package: it reads
`node_modules`, then queries the npm registry for every package installed from a
registry unless `--offline` is set. Registry data takes precedence, and data
from `node_modules` and the lockfile fills the gaps (responses are stored in a
flat-file cache so repeated runs are fast). Third, it computes the semver
intersection of all constraints for each analysis target (the Node.js engine, or
a specific peer package). Finally, it renders the result as a text table or
JSON.

## Requirements

- A Node.js version that `engines.node` in `package.json` allows, as the Node.js
  badge above shows

## Development

Clone the repository and install dependencies with the `.nvmrc` Node, as CI does
(see [CONTRIBUTING.md](CONTRIBUTING.md)):

```sh
git clone https://github.com/ivuorinen/semver-ranger.git
cd semver-ranger
nvm use
npm ci --ignore-scripts
```

| Command             | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/` via tsc (ESM)                              |
| `npm run dev`       | Watch mode compilation                                                   |
| `npm run lint`      | Check formatting, lint rules and Markdown (no writes)                    |
| `npm run lint:md`   | Check Markdown with markdownlint (no writes)                             |
| `npm run lint:fix`  | Apply Prettier, ESLint and markdownlint auto-fixes                       |
| `npm run typecheck` | Type-check `tsconfig.json`, then the stricter `tsconfig.build.json`      |
| `npm run test`      | Run tests with Node's native test runner                                 |
| `npm run cov`       | Tests with coverage; fails below 100% (CI gate, needs the `.nvmrc` Node) |

## Architecture

```text
src/
  cli.ts          Entry point — argument parsing, pipeline orchestration and
                  JSON output
  types.ts        Shared TypeScript type definitions
  analyzer/       Semver intersection logic for engines and peer constraints
  parsers/        Lockfile parsers and production install sets: npm, yarn
                  classic/berry, pnpm, detect, reach
  registry/       npm registry client and local node_modules fallback
  graph/          --no-dev filter; format knowledge stays in parsers/
  cache/          JSON file cache for registry responses
  output/         CLI table rendering and progress spinners
```

Tests live in `test/`, mirroring the `src/` structure. Fixtures for each
lockfile format are in `test/fixtures/`. The test runner is Node's built-in
`node --test`, which runs the TypeScript directly through Node's type stripping
— no Jest, Vitest or loader.

## License

MIT — [Ismo Vuorinen](https://github.com/ivuorinen)
