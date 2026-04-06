# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# 1.0.0 (2026-04-06)


* feat!: rewrite implementation in TypeScript ([#74](https://github.com/ivuorinen/semver-ranger/issues/74)) ([7e20420](https://github.com/ivuorinen/semver-ranger/commit/7e204207bfe17a7d333c0b4884d944d4fc6c832a))


### Bug Fixes

* **ci:** fix publish workflow startup_failure ([acf59e7](https://github.com/ivuorinen/semver-ranger/commit/acf59e79b49e02e03f390d5764e61b390109e44d))
* **config:** resolve Prettier/markdownlint line-length conflict ([56355b8](https://github.com/ivuorinen/semver-ranger/commit/56355b8a768a596639ad29030ba2302349171ca9)), closes [package.json#prettier](https://github.com/package.json/issues/prettier)
* **deps:** update cliui to 9.0.0 ([#22](https://github.com/ivuorinen/semver-ranger/issues/22)) ([aeb6a88](https://github.com/ivuorinen/semver-ranger/commit/aeb6a88c2de53bf05dd2bd2a2d1eb15098d26672))
* **publish:** add publishConfig to allow public scoped package ([b159b53](https://github.com/ivuorinen/semver-ranger/commit/b159b538a9c7e6b37ccb4bf10391981e9e5fdd31))


### Features

* build hardening, simplification, ui improvements, updates ([#85](https://github.com/ivuorinen/semver-ranger/issues/85)) ([c9e0991](https://github.com/ivuorinen/semver-ranger/commit/c9e0991085597ae023f85ca009c029c0b5fe4d98))


### BREAKING CHANGES

* drops CommonJS; package is now ESM-only and
requires Node.js 22+.

* test: add test suite

Full test coverage for parsers, analyzer, registry, graph,
cache, and output modules using Node's native test runner
with tsx/esm loader.

* docs: add claude.md and project documentation

Add CLAUDE.md with project commands, architecture, and key patterns.
Add superpowers design specs and implementation plans.

* fix(output): disambiguate null intersection from no-constraint case

When target.ranges is empty, intersection is null but there is no
conflict. Show '— (no constraints found)' in that case.

Also replace O(n²) latestRanges.find() loops with Map lookups.

* fix(output): convert JSDoc types to TypeScript types

* fix(output): remove JSDoc type annotations where TypeScript types are used

Revert unauthorized eslint.config.mjs change. Remove {Type} from JSDoc
@param/@returns lines in table.ts to resolve TS diagnostic 80004.

* fix(output): document intentional column inversion in latestConflicts loop

* fix(graph): handle scoped packages in yarn-classic edge map

Regexes previously excluded @ so @scope/pkg entries were silently
dropped from the edge map, causing --no-dev filtering to miss those
edges.

Also replace queue.shift() with index pointer in bfs to avoid O(n²)
traversal on large graphs.

* fix(registry): three correctness fixes for fetchLatest and offline mode

- Treat missing/empty version in fetchLatest as failure (return null)
  rather than propagating empty string into cache and output
- Set CONCURRENCY=4 so actual concurrent requests stay within ~8
  (each package triggers 2 parallel fetches)
- In offline mode, enrich from on-disk cache instead of returning
  packages unenriched

* fix(parsers): deduplicate npm v2/v3 packages by name@version

npm lockfiles can have the same name@version at multiple nested
node_modules paths. Other parsers already deduplicate; align npm.

* fix(cli): derive projectDir from lockfile path for local resolution

When --lockfile points outside cwd, resolveLocal, filterDevPackages,
and detectPeerTargets must use the lockfile's directory, not cwd.

* fix(test): restore globalThis.fetch instead of deleting it

On Node 22+, deleting globalThis.fetch removes the native
implementation permanently. Capture and restore it instead.

* fix(ts): enforce strict equality operators (eqeqeq, no-undefined)

* test: fix equality violations and improve helper JSDoc

* chore: exempt CLAUDE.md from editorconfig line-length check

* test: add missing version field to graph-shared fixture

* test: bump express and body-parser in fixture to fix CVEs

* chore(deps): install @ivuorinen/prettier-config devDependency

* ci: pin GitHub Actions to full commit SHAs

* ci: replace @main workflow references with pinned composite actions

* docs: add MegaLinter fix spec and update migration docs

* test: deduplicate engines.test.ts and bump v1 fixture CVEs

- Extract analyzeNode() helper to eliminate jscpd clone violations
  (lines 9-15, 21-27, 44-50 in engines.test.ts)
- Update test assertion for v1 lockfile to match bumped express 4.19.2
- Bump express 4.18.2→4.19.2 and body-parser 1.20.1→1.20.3 in
  package-lock-v1.json to fix trivy CVE-2024-45590 (HIGH)
- Add [docs/**] max_line_length = off to .editorconfig to fix
  editorconfig-checker blocking error on plan files

* ci: disable ts-standard in MegaLinter, add npm ci step

- Add TYPESCRIPT_STANDARD to DISABLE_LINTERS: project already has its
  own TypeScript linting (typescript-eslint + @ivuorinen/eslint-config);
  ts-standard conflicts with prettier over space-before-function-paren
- Add npm ci step before MegaLinter so type definitions are available
  (prevents false-positive any-type errors in type-dependent rules)

* docs: apply prettier formatting to plan and spec files

* chore: set audit-level=critical in .npmrc

brace-expansion@5.0.4 and picomatch@4.0.3 are bundled (inBundle: true)
inside npm@11.12.1 which is pulled in by @semantic-release/npm. npm
overrides cannot reach inBundle packages; npm has not released a patched
version yet. Production deps have 0 vulnerabilities (npm audit --omit=dev).

Setting audit-level=critical keeps the audit exit-0 for high/moderate
findings in devDependency-only inBundle packages until npm ships a fix.

* chore: update @ivuorinen/eslint-config to v1.0.19

* ci: add .mega-linter.yml and fix failing MegaLinter linters

- Add .mega-linter.yml adapted from base-configs reference; disables
  devskim (node_modules false positives), SPELL linters, and JS/TS
  standard; configures trivy to skip test/fixtures; sets ESLint flat
  config file and excludes node_modules via FILTER_REGEX_EXCLUDE
- Add .grype.yaml to suppress vulnerabilities in test/fixtures (old
  lockfiles kept intentionally for parser tests)
- Move APPLY_FIXES, DISABLE_LINTERS, SARIF_REPORTER out of workflow
  env into .mega-linter.yml
- Fix editorconfig indent errors (3→4 spaces) in two spec docs

* docs: add design spec for MegaLinter remaining fixes

* ci: fix remaining MegaLinter failures

- Remove invalid SPELL descriptor from DISABLE_LINTERS (fixes v8r schema error)
- Disable TYPESCRIPT_ES and JAVASCRIPT_ES (ESLint v9 flat config rejects
  legacy --eslintrc flag; ESLint already runs in CI)
- Add REPOSITORY_KINGFISHER_FILTER_REGEX_EXCLUDE to skip node_modules
  (repository linters ignore the global FILTER_REGEX_EXCLUDE)
- Add YAML_V8R_FILTER_REGEX_EXCLUDE for .grype.yaml and test/fixtures
  (no registered JSON Schema for those files)
- Add .markdownlint-cli2.jsonc with MD013 override for docs/superpowers/
  and point MARKDOWN_MARKDOWNLINT_CONFIG_FILE at it

* ci: disable kingfisher and fix .mega-linter.yml schema validity

REPOSITORY_KINGFISHER_FILTER_REGEX_EXCLUDE is not an allowed property
per the MegaLinter JSON schema (additionalProperties: false), which was
causing v8r to reject .mega-linter.yml. Replace with REPOSITORY_KINGFISHER
in DISABLE_LINTERS — all kingfisher findings are node_modules false positives.

Verified valid with: npx v8r .mega-linter.yml

* [MegaLinter] Apply linters fixes
