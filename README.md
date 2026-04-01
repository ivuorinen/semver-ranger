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
