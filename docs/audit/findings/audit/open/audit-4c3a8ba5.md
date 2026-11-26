---
id: audit-4c3a8ba5
auditor: audit
severity: medium
category: conventions
area: src/cli.ts
status: open
found: 2026-11-24
location: src/cli.ts:333-338
location_sha: 20a0f659daff08d3
---

# The pending --json shape change is breaking, but the BREAKING CHANGE note audit-cd19913e prescribes leaves it out

## Problem

AUD:S11. v5.0.7's `--json` printed the bare targets array; the working tree prints `{ targets, unresolved, skipped }`. A script doing `JSON.parse(out).filter(...)` or `jq '.[]'` breaks on upgrade. audit-cd19913e, the open finding that tracks the release marker, states "JSON output shape and the flag set are unchanged", and its Fix lists only the `--no-dev` and pnpm < 6 changes for the BREAKING CHANGE footer. errors-e18d7a96's resolution flagged this ("This is a breaking change for audit-cd19913e's note"), but the open finding was never updated, so following it publishes 6.0.0 notes that omit the change scripts are most likely to hit.

## Evidence

`git show v5.0.7:src/output/table.ts` line 205: `return JSON.stringify(targets, null, 2)`. Working tree src/cli.ts:337: `JSON.stringify({ targets: allTargets, unresolved: failures, skipped }, null, 2)`. README.md:139-140 already says "Before 6.0.0, `--json` printed the bare `targets` array." The `AnalysisTarget` and `RangeEntry` interfaces, the flag set and the exit codes are unchanged between v5.0.7 and the working tree, so this is the only JSON contract change.

## Impact

Consumers reading the 6.0.0 release notes to adapt get no warning about the one change that breaks every JSON-reading script. semantic-release builds the notes from the commit footer, so a footer missing it cannot be fixed after publish.

## Fix

When writing the commit or PR for this branch, add to the BREAKING CHANGE footer: "--json now prints an object { targets, unresolved, skipped } instead of the bare targets array; read .targets." Resolve this finding together with audit-cd19913e once the merged commit carries it.
