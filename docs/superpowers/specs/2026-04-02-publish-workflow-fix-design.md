# Publish Workflow Fix Design

**Date:** 2026-04-02 **Scope:** Fix `startup_failure` on every push to main caused by `publish.yml` calling `pr-lint.yml` as a reusable workflow

---

## Problem

`publish.yml` has been failing with `startup_failure` on every push to main since the workflow was introduced. The cause is two-fold:

1. `publish.yml` calls `pr-lint.yml` as a reusable workflow (`uses: ./.github/workflows/pr-lint.yml`) and lists it as a required gate for publishing.
2. `pr-lint.yml` uses `${{ secrets.GITHUB_TOKEN }}` in its workflow-level `env` block. GitHub Actions explicitly disallows the `secrets` context in workflow-level `env` for reusable workflows, which causes `startup_failure` before any job runs.

MegaLinter (what `pr-lint.yml` runs) is designed for PR review — it's slow (~5–10 min), applies auto-fixes, and is not an appropriate publish gate. The project already has a CI workflow that runs linting and tests as a publish prerequisite.

---

## Changes

### `publish.yml`

- Remove the `pr-lint` job block
- Change `needs: [ci, pr-lint]` → `needs: [ci]`

### `pr-lint.yml`

- Remove `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` from the workflow-level `env` block
- `APPLY_FIXES_EVENT` and `APPLY_FIXES_MODE` remain
- All step-level `GITHUB_TOKEN` references are untouched (checkout, MegaLinter step, create-pull-request — each already sets it at the step level)

---

## Result

- `publish.yml`: triggers on push to main → waits for `ci` → runs semantic-release
- `pr-lint.yml`: runs MegaLinter on PRs only, as intended
- The workflow-level `env` bug in `pr-lint.yml` is fixed, preventing confusion if the reusable call is re-added in future

---

## Files

| Action | File                            |
| ------ | ------------------------------- |
| Modify | `.github/workflows/publish.yml` |
| Modify | `.github/workflows/pr-lint.yml` |
