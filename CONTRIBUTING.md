# Contributing

`semver-ranger` finds the safe Node.js and peer dependency version ranges across
a project's whole dependency tree. This guide covers reporting problems and
changing the code.

## Reporting issues

Open an issue with the bug report or feature request template in
`.github/ISSUE_TEMPLATE/`. Everyone taking part in the project follows the code
of conduct in `.github/CODE_OF_CONDUCT.md`.

## Setup

Development and CI use the Node.js version in `.nvmrc`. The published package
supports the Node.js versions that `engines.node` in `package.json` allows.

```sh
nvm use
npm ci --ignore-scripts
```

`--ignore-scripts` matches CI and skips the starter-config scripts of the
`@ivuorinen/*` config packages, which this repository does not need.

## Checks

CI runs these in order, and each one has to pass:

```sh
npm run lint
npm run typecheck
npm run cov
node .github/scripts/coverage-merge-guard.mjs
npm run build
node .github/scripts/pack-check.mjs
node .github/scripts/release-notes-smoke.mjs
```

`pack-check.mjs` fails when the npm tarball would ship anything besides `dist/`
and the files npm always adds, or would ship without `dist/cli.js`.
`npm run lint:fix` applies Prettier, ESLint and markdownlint fixes.

`.pre-commit-config.yaml` checks trailing whitespace, final newlines, YAML
syntax and large files. CI does not run these hooks, so install them with
`prek install` to catch those problems before a commit.

## Tests

Tests use Node's built-in runner and live in `test/`, mirroring `src/`.
`test/cli.test.ts` covers flags, exit codes and warnings by running the CLI in a
child process. A bug fix needs a test that fails without it.

`npm run cov` runs the tests and fails below 100% of lines, branches and
functions in `src/`, counting files no test loads and the CLI child processes.
Only `src/types.ts` is excluded, because it holds no runtime code. Delete code
that cannot run instead of excluding it. It needs the Node.js version in
`.nvmrc`, because older Node.js versions do not have
`--test-coverage-include-all`.

Node's coverage merge can drop a branch no test takes once a CLI test's child
process runs the block around it, so CI also runs
`node .github/scripts/coverage-merge-guard.mjs`. It fails when a branch that the
run without `test/cli.test.ts` reports as never taken has no entry in the full
run. Cover such a branch in a unit test, even when the CLI tests reach it.

## Commit messages

Releases are automatic. semantic-release reads the Conventional Commits on
`main`, so the commit type decides the next version, by the rules in
`@ivuorinen/semantic-release-config`:

| Commit                                             | Release |
| -------------------------------------------------- | ------- |
| `feat:`                                            | minor   |
| `fix:`, `perf:`, `revert:`                         | patch   |
| `chore(deps):`                                     | patch   |
| `!` after the type, or a `BREAKING CHANGE:` footer | major   |
| any other type                                     | none    |

Pull requests are squash-merged. The commit on `main` takes the title of the
only commit in the pull request, or the pull request title when it has more than
one, so that title must be a Conventional Commit.

Mark a change as breaking only when it breaks people using the CLI. A major
version bump of a development dependency is not a breaking change here.

## Pull requests

Every change goes through a pull request against `main`, and history stays
linear. A pull request merges only with:

- the `CI` and `MegaLinter` checks passing on a branch that is up to date with
  `main`
- one approving review
- no CodeQL alert at error level and no security alert of high severity or above
- no code quality finding at error level

MegaLinter only reports: it runs code from the dependencies the pull request
installs, so it gets no token to push fixes with. Run `npm run lint:fix` and fix
the rest by hand. Code owners are listed in `.github/CODEOWNERS`.

## License

`semver-ranger` is released under the MIT license in `LICENSE`, and
contributions are accepted under the same license.
