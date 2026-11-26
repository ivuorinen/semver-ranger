# semver-ranger

CLI tool that parses npm/yarn/pnpm lockfiles to analyze `engines` and `peerDependencies` version constraints across the full dependency tree.

## Commands

```bash
npm run build   # Compile TypeScript → dist/ via tsc (ESM)
npm run dev     # Watch mode compilation
npm run lint    # Check formatting + lint rules (no writes; this is the CI gate)
npm run lint:fix # Apply Prettier, ESLint and markdownlint auto-fixes
npm run typecheck # tsc --noEmit on tsconfig.json, then on tsconfig.build.json (noUncheckedIndexedAccess)
npm run test    # Run tests with Node's native test runner
npm run cov     # Tests with coverage; fails below 100% (this is what CI runs)
```

## Requirements

- Published package: the range in `package.json` `engines.node`. Advisory only: `.npmrc` sets no `engine-strict` and the CLI has no runtime check
- Development: the `.nvmrc` version; `npm run cov` uses `--test-coverage-include-all`, which older Node versions lack

## Architecture

```text
src/
  cli.ts          # Entry point (shebang, parseArgs)
  types.ts        # Shared type definitions
  analyzer/       # semver constraint logic (engines, peers, intersect)
  parsers/        # One file per lockfile format: packages and what production installs
  registry/       # npm registry client + local node_modules fallback
  graph/          # --no-dev filter; format knowledge stays in parsers/
  cache/          # JSON file cache for registry responses
  output/         # CLI table rendering

test/
  cli.test.ts     # Spawns the CLI: flags, exit codes, warnings
  fixtures/       # Sample lockfiles for parser tests
  analyzer/ cache/ graph/ output/ parsers/ registry/   # Mirror src/
```

## Key Patterns

- **ESM-only**: All code uses ES modules; no CJS output
- **Bin-only package**: no `main`, and `tsconfig.build.json` emits JavaScript without declaration files — not meant to be imported as a library
- **Tarball allowlist**: `files` ships only `dist/` (npm adds `package.json`, `README.md` and `LICENSE`); `.github/scripts/pack-check.mjs` fails CI on any other path
- **Native TypeScript**: Node runs `.ts` directly via type stripping, so relative imports use `.ts` and `tsc` rewrites them to `.js` on build; `erasableSyntaxOnly` and `verbatimModuleSyntax` reject code Node cannot strip
- **Native test runner**: `node --test` with no loader; no Jest/Vitest
- **Few runtime dependencies**: `dependencies` in `package.json` is the full list; prefer a Node built-in to adding one
- **Audit overrides**: entries in `package.json` `overrides` force patched versions upstream has not adopted. The `npm@11` entry aliases `@semantic-release/npm`'s `npm` dependency to the inert `ms`, because npm's bundled `glob` and `minimatch` cannot be overridden; the plugin then runs the `npm` on `PATH`, which trusted publishing needs at >= 11.5.1. To undo the alias, delete the override and the `node_modules/@semantic-release/npm/node_modules/npm` lockfile entry, then run `npm install`
- **Tools via config packages**: `prettier`, `eslint`, `markdownlint`, `semantic-release` and the `@semantic-release/*` plugins are not declared here; they are hoisted from the `@ivuorinen/*` config packages
- **Lockfile auto-detection**: `src/parsers/detect.ts` picks the right parser
- **Registry fallback**: Tries npm registry first, falls back to local `node_modules`
- **package.json version**: Read via `createRequire` (ESM workaround for JSON imports)
