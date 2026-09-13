---
id: ci-c25d7e0d
auditor: ci
severity: medium
category: reliability
area: .github/workflows/ci.yml
status: open
found: 2026-09-13
---

# non-gating-check: CI and MegaLinter are not required; main ruleset is disabled (Verified)

## Problem

ci.yml (job `CI`: lint, typecheck, test, build) and pr-lint.yml (job `MegaLinter`) are gate-shaped pull_request workflows, but main has no branch protection and its only ruleset has enforcement `disabled`, so neither check blocks a merge and main accepts direct pushes.

## Evidence

Tool: manual, Verified.

- `gh api repos/ivuorinen/semver-ranger/branches/main/protection` -> HTTP 404 "Branch not protected".
- `gh api repos/ivuorinen/semver-ranger/rulesets/2316946` -> name `main`, enforcement `disabled`, rules: deletion, non_fast_forward, required_linear_history, pull_request, update; no `required_status_checks` rule.

## Impact

A PR with failing tests or lint merges to main and Publish.yml releases it; any contents:write token (e.g. pr-lint's) can push straight to main and trigger an npm release.

## Fix

In the `main` ruleset set enforcement to `active` and add a `required_status_checks` rule with contexts `CI` and `MegaLinter`. User-run (never auto-applied): edit at <https://github.com/ivuorinen/semver-ranger/rules/2316946>, then verify with `gh api repos/ivuorinen/semver-ranger/rulesets/2316946 --jq '.enforcement, [.rules[]|select(.type=="required_status_checks").parameters.required_status_checks[].context]'`.
