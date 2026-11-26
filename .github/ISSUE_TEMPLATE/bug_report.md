---
name: Bug report
about: Report a wrong result, a crash or a misleading message
title: ''
labels: bug
assignees: ivuorinen
---

**What happened**: what the command printed or did, and what you expected instead.

**Command**: the exact command line, with every flag.

```sh
semver-ranger
```

**Versions**:

- `semver-ranger --version`:
- `node --version`:
- Package manager and its version:
- Lockfile: `package-lock.json` (its `lockfileVersion`), `npm-shrinkwrap.json`, `yarn.lock` (Classic or Berry) or `pnpm-lock.yaml` (its `lockfileVersion`):

**Output**: the full stderr, and stdout if the result is wrong. A run with `--json` makes a wrong result easiest to show.

```text

```

**Lockfile excerpt**: the smallest part of the lockfile, and of `package.json` for `--no-dev` problems, that shows the problem. Remove private package names first.
