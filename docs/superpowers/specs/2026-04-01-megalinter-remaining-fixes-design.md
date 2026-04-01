# MegaLinter Remaining Fixes — Design

**Date:** 2026-04-01 **Branch:** feat/complete-rewrite

## Context

After the initial `.mega-linter.yml` was added in `10bed30`, three linters remain ❌ and markdownlint has 368 ⚠️ warnings. This spec describes the exact changes needed to clear all remaining failures.

## Failures to Fix

### 1. `YAML / v8r` — two separate causes

**Cause A:** `SPELL` in `DISABLE_LINTERS` is a MegaLinter descriptor name, not a valid linter ID. The MegaLinter JSON Schema (used by v8r) rejects it. `SPELL_CSPELL` and `SPELL_LYCHEE` already cover what `SPELL` was intended to disable.

**Cause B:** `.grype.yaml` and `test/fixtures/*.yaml` have no registered JSON Schema. v8r treats "no schema found" as an error.

### 2. `TYPESCRIPT / eslint` — flat config incompatibility

MegaLinter 9 passes the legacy `--eslintrc` flag to ESLint, which ESLint v9 (flat config mode) rejects outright with: `Invalid option '--eslintrc'`. ESLint runs as a separate CI step anyway, so duplicating it in MegaLinter provides no benefit.

### 3. `REPOSITORY / kingfisher` — node_modules scanning

The global `FILTER_REGEX_EXCLUDE` only filters file-based linters. Repository-type linters (including kingfisher) scan the whole repo and ignore it. All 9 kingfisher findings are in `node_modules/`.

### 4. `MARKDOWN / markdownlint` — line-length warnings (368)

`markdownlint` reads its own rules from `.markdownlint.json`, not from `.editorconfig`. The root `.markdownlint.json` enables `line-length: true` (MD013, 80-char limit). Spec and plan docs under `docs/superpowers/` are prose-heavy design documents where enforcing 80-char lines is counterproductive.

## Design

### `.mega-linter.yml` changes

```yaml
DISABLE_LINTERS:
  - JAVASCRIPT_ES # add: flat config incompatibility
  - JAVASCRIPT_STANDARD
  - REPOSITORY_DEVSKIM
  # remove SPELL           # invalid descriptor name
  - SPELL_CSPELL
  - SPELL_LYCHEE
  - TYPESCRIPT_ES # add: flat config incompatibility
  - TYPESCRIPT_STANDARD

# add: repository linters need their own exclude
REPOSITORY_KINGFISHER_FILTER_REGEX_EXCLUDE: node_modules

# add: skip files with no registered JSON Schema
YAML_V8R_FILTER_REGEX_EXCLUDE: (\.grype\.yaml|test/fixtures)

# update: point to cli2 config that supports per-glob overrides
MARKDOWN_MARKDOWNLINT_CONFIG_FILE: .markdownlint-cli2.jsonc
```

### New file: `.markdownlint-cli2.jsonc`

markdownlint-cli2 (used by MegaLinter 9) supports a `config` + `overrides` structure when the config file is in cli2 format. The root `.markdownlint.json` stays unchanged for local editor tooling.

```jsonc
{
  "config": {
    "extends": "@ivuorinen/markdownlint-config",
    "line-length": true
  },
  "overrides": [
    {
      "globs": ["docs/superpowers/**/*.md"],
      "config": {
        "MD013": false
      }
    }
  ]
}
```

### `.editorconfig` — no change needed

`[docs/**]` already sets `max_line_length = off`, which covers `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md`. editorconfig-checker is already ✅.

## Files Changed

| File                       | Action                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `.mega-linter.yml`         | Update DISABLE_LINTERS, add KINGFISHER + V8R excludes, update markdownlint config ref |
| `.markdownlint-cli2.jsonc` | Create — cli2 config with MD013 override for docs/superpowers/                        |

## Verification

After pushing, the next MegaLinter run should show:

- `YAML / v8r` → ✅
- `TYPESCRIPT / eslint` → ✅ (disabled)
- `REPOSITORY / kingfisher` → ✅
- `MARKDOWN / markdownlint` → ✅ (or reduced to 0 warnings for docs/superpowers/)
