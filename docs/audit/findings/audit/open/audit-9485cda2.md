---
id: audit-9485cda2
auditor: audit
severity: low
category: reliability
area: src/parsers/npm.ts
status: open
found: 2026-07-26
---

# npm lockfileVersion dispatch does not validate the version

## Problem

`parseNpmLockfile` chooses its branch with `lock.lockfileVersion >= 2`. When the field is absent, a string, or otherwise non-numeric, the comparison is `false` and parsing silently falls through to the v1 shape, which reads `lock.dependencies` and returns `[]` for anything that is not a v1 lockfile.

This is the residual of `audit-23df4111`. That finding was resolved as fixed for the user-facing half — the CLI now warns when packages parsed but no constraints resolved — while the dispatch itself was explicitly left alone. Filed separately so the store does not carry an admission of unfinished work inside a resolved record.

## Evidence

`src/parsers/npm.ts`: `if (lock.lockfileVersion >= 2)`. A truncated or hand-edited `package-lock.json` with no `lockfileVersion` yields `[]` with no error. The CLI warning added for the parent finding fires only when zero targets resolve, so a malformed lockfile that still produces some registry hits stays invisible.

## Impact

A malformed lockfile is reported as a lockfile with no dependencies rather than as an error. Low severity because the common inputs are well-formed and the empty-analysis warning covers the total-failure case, but the parser should not guess.

## Fix

Dispatch explicitly and fail loudly on anything unrecognised:

    const version = lock.lockfileVersion
    if (typeof version !== 'number') {
      throw new Error('unrecognised package-lock.json: missing lockfileVersion')
    }
    if (version >= 2) { /* v2/v3 */ }
    if (version === 1) { /* v1 */ }
    throw new Error(`unsupported package-lock.json lockfileVersion: ${version}`)

`cli.ts` already surfaces thrown parse errors through the spinner's fail path. Add fixtures for a missing and an unknown `lockfileVersion`.
