---
id: audit-cd19913e
auditor: audit
severity: medium
category: conventions
area: src/cli.ts
status: open
found: 2026-11-17
location: src/cli.ts:213-218
location_sha: 245c43851beeeab5
---

# Pending changes add new exit-1 paths, so the eventual commit must be marked breaking

## Problem

AUD:S11. The uncommitted work turns inputs that v5.0.7 accepted (exit 0) into errors (exit 1): `--no-dev` without a readable package.json now throws (src/cli.ts:215-217) where v5.0.7's `filterDevPackages` returned the packages unfiltered, and a pnpm lockfile below version 6 now throws (src/parsers/pnpm.ts:51) where v5.0.7 parsed it. Stricter validation of existing inputs is a breaking change for scripts and CI jobs that run the CLI. Nothing is committed yet (`git rev-list --count v5.0.7..HEAD` = 0) and the branch is named fix/update-packages, so the natural label is `fix:`, which would release 5.0.8.

## Evidence

`git show HEAD:src/graph/index.ts` lines 151-157: `try { ... readFileSync(join(projectDir, 'package.json')) ... } catch { return packages }`. `git show HEAD:src/parsers/pnpm.ts` has no lockfileVersion throw; the working tree has `if (!(Number(lock.lockfileVersion) >= MIN_LOCKFILE_VERSION)) throw ...` at pnpm.ts:51. The `--no-dev` semantics also changed (production-install sets instead of direct devDependencies). The npm missing-lockfileVersion error already shipped before v5.0.7, so it is not part of this change. JSON output shape and the flag set are unchanged. Repo settings: squash-only merges with `squash_merge_commit_title: COMMIT_OR_PR_TITLE`, so the PR title (or a single commit's title) is what semantic-release reads.

## Impact

Shipping as `fix:` publishes these new failure modes in a patch release to users on `^5`, the under-versioning direction that silently breaks pinned-range consumers.

## Fix

When committing, title the PR (or the single commit) with `!` or add a `BREAKING CHANGE:` footer naming: `--no-dev` follows each package manager's production install, and with Yarn lockfiles it now requires a readable package.json for the project and every workspace member (npm and pnpm need none, after audit-c21c640b); pnpm lockfiles older than v6 are rejected; `--json` now prints `{ targets, unresolved, skipped, latestUncached }`, with each `unresolved` entry an object `{ name, version, reason }`, instead of the bare targets array (audit-4c3a8ba5). That releases 6.0.0. Resolve this finding, and audit-4c3a8ba5, once the merged commit carries the marker.
