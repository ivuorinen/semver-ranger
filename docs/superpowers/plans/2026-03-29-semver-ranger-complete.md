# semver-ranger Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform semver-ranger into a complete TypeScript CLI that parses npm/yarn/pnpm lockfiles and analyzes engine + peer dependency version constraints across the full dependency tree, with registry-backed upgrade path analysis and rich cliui output.

**Architecture:** Pipeline CLI — detect lockfile → parse → resolve (node_modules + registry with cache) → analyze (intersect semver ranges) → render (cliui tables). Each stage is a standalone module with a clean interface. TDD throughout.

**Tech Stack:** TypeScript 5+, tsup (build), tsx + Node built-in test runner, cliui, semver, @yarnpkg/lockfile, @yarnpkg/parsers, yaml (pnpm), flat-cache, env-paths, typescript-eslint

---

## File Map

```
src/
  cli.ts                      ← arg parsing + pipeline orchestration
  types.ts                    ← all shared interfaces/types
  parsers/
    detect.ts                 ← find lockfile in directory tree
    npm.ts                    ← parse package-lock.json (v1/v2/v3)
    yarn-classic.ts           ← parse yarn.lock classic via @yarnpkg/lockfile
    yarn-berry.ts             ← parse yarn.lock berry via @yarnpkg/parsers
    pnpm.ts                   ← parse pnpm-lock.yaml via yaml package
  registry/
    local.ts                  ← read engines/peerDeps from node_modules
    client.ts                 ← fetch manifests from registry.npmjs.org
  cache/
    index.ts                  ← XDG path resolution + flat-cache wrapper
  analyzer/
    intersect.ts              ← shared semver intersection logic
    engines.ts                ← collect + intersect engines ranges
    peers.ts                  ← collect + intersect peerDep ranges
  output/
    table.ts                  ← cliui table renderer

test/
  parsers/
    npm.test.ts
    yarn-classic.test.ts
    yarn-berry.test.ts
    pnpm.test.ts
    detect.test.ts
  registry/
    local.test.ts
    client.test.ts
  cache/
    index.test.ts
  analyzer/
    intersect.test.ts
    engines.test.ts
    peers.test.ts
  output/
    table.test.ts
  fixtures/
    package-lock.json         ← minimal v3 npm lockfile
    package-lock-v1.json      ← minimal v1 npm lockfile
    yarn-classic.lock
    yarn-berry.lock
    pnpm-lock.yaml
    package.json              ← minimal project package.json

Modified:
  package.json                ← deps, scripts, bin, engines
  eslint.config.mjs           ← add TypeScript support
  .gitignore                  ← add dist/

Deleted (Task 17):
  index.js
  lib/parser.js
```

---

## Task 1: Project Setup

**Files:**

- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Update package.json**

Replace the entire file:

```json
{
  "name": "@ivuorinen/semver-ranger",
  "version": "1.0.0",
  "description": "Parses lockfiles to find engine and peer dependency version ranges across your full dependency tree",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "semver-ranger": "dist/cli.js"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "lint": "eslint --fix .",
    "test": "node --import tsx/esm --test 'test/**/*.test.ts'"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ivuorinen/semver-ranger.git"
  },
  "keywords": [
    "npm",
    "package-lock",
    "semver",
    "range",
    "calculator",
    "cli",
    "engines",
    "node-version"
  ],
  "author": "Ismo Vuorinen <https://github.com/ivuorinen>",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/ivuorinen/semver-ranger/issues"
  },
  "homepage": "https://github.com/ivuorinen/semver-ranger#readme",
  "dependencies": {
    "@yarnpkg/lockfile": "^1.1.0",
    "@yarnpkg/parsers": "^3.0.0",
    "cliui": "^9.0.0",
    "env-paths": "^3.0.0",
    "flat-cache": "^6.0.0",
    "semver": "^7.6.3",
    "yaml": "^2.0.0"
  },
  "devDependencies": {
    "@ivuorinen/eslint-config": "^1.0.0",
    "@ivuorinen/markdownlint-config": "^1.0.0",
    "@ivuorinen/semantic-release-config": "^1.0.0",
    "@types/node": "^24.0.0",
    "@types/semver": "^7.5.0",
    "@types/yarnpkg__lockfile": "^1.1.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false
})
```

- [ ] **Step 4: Update eslint.config.mjs**

```javascript
import ivuorinenConfig from '@ivuorinen/eslint-config'
import tseslint from 'typescript-eslint'

export default [
  ...ivuorinenConfig,
  ...tseslint.configs.recommended,

  {
    ignores: ['*.yml', 'dist/**']
  },

  {
    rules: {
      'max-len': ['warn', { code: 100 }]
    }
  },

  {
    files: ['src/cli.ts'],
    rules: {
      'no-console': 'off',
      'n/no-process-exit': 'off'
    }
  }
]
```

- [ ] **Step 5: Create placeholder src/cli.ts so build works**

Create `src/cli.ts`:

```typescript
#!/usr/bin/env node
// entrypoint — implemented in Task 16
```

- [ ] **Step 6: Run npm install**

```bash
npm install
```

Expected: packages installed, no fatal errors (peer warning about eslint-plugin-import is OK).

- [ ] **Step 7: Verify build works**

```bash
npm run build
```

Expected: `dist/cli.js` created, exit 0.

- [ ] **Step 8: Verify lint passes**

```bash
npm run lint
```

Expected: exit 0, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts eslint.config.mjs src/cli.ts
git commit -m "chore: set up TypeScript, tsup, and updated deps"
```

---

## Task 2: Shared Types

**Files:**

- Create: `src/types.ts`

- [ ] **Step 1: Create src/types.ts**

```typescript
export interface Package {
  name: string
  version: string
  latestVersion?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
  latestEngines?: Record<string, string>
  latestPeerDependencies?: Record<string, string>
}

export interface RangeEntry {
  package: string
  version: string
  range: string
}

export interface AnalysisTarget {
  name: string
  source: 'engines' | 'peerDependencies'
  /** Ranges from currently installed versions */
  ranges: RangeEntry[]
  /** Computed safe range for installed versions; null if conflict */
  intersection: string | null
  /** Entries that break the installed intersection */
  conflicts: RangeEntry[]
  /** Ranges from latest available versions */
  latestRanges: RangeEntry[]
  /** Computed safe range for latest versions; null if conflict */
  latestIntersection: string | null
  /** Entries that break the latest intersection */
  latestConflicts: RangeEntry[]
}

export interface CliOptions {
  lockfilePath?: string
  offline: boolean
  check: string[]
  noDev: boolean
  all: boolean
  json: boolean
}

export type LockfileType = 'npm' | 'yarn-classic' | 'yarn-berry' | 'pnpm'
export type ManagerType = 'npm' | 'yarn' | 'pnpm'

export interface DetectedLockfile {
  path: string
  type: LockfileType
  manager: ManagerType
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

## Task 3: Test Fixtures

**Files:**

- Create: `test/fixtures/package-lock.json`
- Create: `test/fixtures/package-lock-v1.json`
- Create: `test/fixtures/yarn-classic.lock`
- Create: `test/fixtures/yarn-berry.lock`
- Create: `test/fixtures/pnpm-lock.yaml`
- Create: `test/fixtures/package.json`

- [ ] **Step 1: Create test/fixtures/package-lock.json (v3 format)**

```json
{
  "name": "test-project",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "test-project",
      "version": "1.0.0",
      "dependencies": {
        "semver": "^7.6.3"
      },
      "devDependencies": {
        "typescript": "^5.0.0"
      }
    },
    "node_modules/semver": {
      "version": "7.6.3",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.6.3.tgz",
      "integrity": "sha512-abc123"
    },
    "node_modules/cliui": {
      "version": "8.0.1",
      "resolved": "https://registry.npmjs.org/cliui/-/cliui-8.0.1.tgz",
      "integrity": "sha512-def456",
      "dev": true
    },
    "node_modules/cliui/node_modules/wrap-ansi": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-7.0.0.tgz",
      "integrity": "sha512-ghi789"
    }
  }
}
```

- [ ] **Step 2: Create test/fixtures/package-lock-v1.json (v1 format)**

```json
{
  "name": "test-project",
  "version": "1.0.0",
  "lockfileVersion": 1,
  "requires": true,
  "dependencies": {
    "semver": {
      "version": "7.6.3",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.6.3.tgz",
      "integrity": "sha512-abc123"
    },
    "cliui": {
      "version": "8.0.1",
      "resolved": "https://registry.npmjs.org/cliui/-/cliui-8.0.1.tgz",
      "integrity": "sha512-def456",
      "dev": true
    }
  }
}
```

- [ ] **Step 3: Create test/fixtures/yarn-classic.lock**

```
# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


cliui@^8.0.0:
  version "8.0.1"
  resolved "https://registry.npmjs.org/cliui/-/cliui-8.0.1.tgz#abc"
  integrity sha512-def456

semver@^7.6.3, semver@^7.3.0:
  version "7.6.3"
  resolved "https://registry.npmjs.org/semver/-/semver-7.6.3.tgz#def"
  integrity sha512-abc123
```

- [ ] **Step 4: Create test/fixtures/yarn-berry.lock**

```
__metadata:
  version: 6
  cacheKey: 8

"cliui@npm:^8.0.0":
  version: 8.0.1
  resolution: "cliui@npm:8.0.1"
  checksum: abc123
  languageName: node
  linkType: hard

"semver@npm:^7.6.3":
  version: 7.6.3
  resolution: "semver@npm:7.6.3"
  checksum: def456
  languageName: node
  linkType: hard
```

- [ ] **Step 5: Create test/fixtures/pnpm-lock.yaml**

```yaml
lockfileVersion: '6.0'

importers:
  .:
    dependencies:
      semver:
        specifier: ^7.6.3
        version: 7.6.3
    devDependencies:
      cliui:
        specifier: ^8.0.0
        version: 8.0.1

packages:
  /cliui@8.0.1:
    resolution: { integrity: sha512-def456 }
    dev: true

  /semver@7.6.3:
    resolution: { integrity: sha512-abc123 }
    dev: false
```

- [ ] **Step 6: Create test/fixtures/package.json**

```json
{
  "name": "test-project",
  "version": "1.0.0",
  "dependencies": {
    "semver": "^7.6.3",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/
git commit -m "test: add lockfile fixtures"
```

---

## Task 4: Intersection Utility

**Files:**

- Create: `src/analyzer/intersect.ts`
- Create: `test/analyzer/intersect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/analyzer/intersect.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import semver from 'semver'
import { computeIntersection } from '../../src/analyzer/intersect.js'
import type { RangeEntry } from '../../src/types.js'

function entry(pkg: string, range: string): RangeEntry {
  return { package: pkg, version: '1.0.0', range }
}

test('empty ranges returns null intersection', () => {
  const result = computeIntersection([])
  assert.equal(result.intersection, null)
  assert.deepEqual(result.conflicts, [])
})

test('single range returns that range', () => {
  const result = computeIntersection([entry('a', '>=14.0.0')])
  assert.ok(result.intersection !== null)
  assert.equal(result.conflicts.length, 0)
})

test('two overlapping ranges returns intersection', () => {
  const result = computeIntersection([
    entry('a', '>=14.0.0'),
    entry('b', '>=18.0.0')
  ])
  assert.ok(result.intersection !== null)
  assert.equal(result.conflicts.length, 0)
  assert.ok(!semver.satisfies('17.0.0', result.intersection!))
  assert.ok(semver.satisfies('20.0.0', result.intersection!))
})

test('disjoint ranges returns null with conflicts', () => {
  const b = entry('b', '>=20.0.0')
  const result = computeIntersection([entry('a', '>=14.0.0 <18.0.0'), b])
  assert.equal(result.intersection, null)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].package, 'b')
})

test('star range is ignored', () => {
  const result = computeIntersection([entry('a', '*'), entry('b', '>=18.0.0')])
  // * is filtered out, only b's range remains
  assert.ok(result.intersection !== null)
  assert.equal(result.conflicts.length, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | head -20
```

Expected: error about `../../src/analyzer/intersect.js` not found.

- [ ] **Step 3: Create src/analyzer/intersect.ts**

```typescript
import semver from 'semver'
import type { RangeEntry } from '../types.js'

export interface IntersectionResult {
  intersection: string | null
  conflicts: RangeEntry[]
}

/**
 * Computes the semver intersection of all given ranges.
 * Entries with '*' or invalid ranges are ignored.
 * Returns null intersection if any ranges are disjoint.
 */
export function computeIntersection(ranges: RangeEntry[]): IntersectionResult {
  const valid = ranges.filter(
    r => r.range !== '*' && semver.validRange(r.range) !== null
  )

  if (valid.length === 0) {
    return { intersection: null, conflicts: [] }
  }

  const conflicts: RangeEntry[] = []
  let combined = valid[0].range

  for (let i = 1; i < valid.length; i++) {
    if (!semver.intersects(combined, valid[i].range)) {
      conflicts.push(valid[i])
    } else {
      combined = `${combined} ${valid[i].range}`
    }
  }

  if (conflicts.length > 0) {
    return { intersection: null, conflicts }
  }

  return {
    intersection: semver.validRange(combined),
    conflicts: []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "intersection" 2>&1
```

Expected: all 5 intersection tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/intersect.ts test/analyzer/intersect.test.ts
git commit -m "feat: add semver intersection utility"
```

---

## Task 5: npm Lockfile Parser

**Files:**

- Create: `src/parsers/npm.ts`
- Create: `test/parsers/npm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/parsers/npm.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmLockfile } from '../../src/parsers/npm.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../fixtures')

test('parses v3 lockfile and returns all packages', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf-8')
  const packages = parseNpmLockfile(content)

  assert.ok(
    packages.length >= 3,
    `expected >=3 packages, got ${packages.length}`
  )
  const semverPkg = packages.find(p => p.name === 'semver')
  assert.ok(semverPkg, 'semver package not found')
  assert.equal(semverPkg!.version, '7.6.3')
})

test('skips root package entry', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf-8')
  const packages = parseNpmLockfile(content)
  const root = packages.find(p => p.name === '')
  assert.equal(root, undefined, 'root entry should be excluded')
})

test('handles nested node_modules paths', () => {
  const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf-8')
  const packages = parseNpmLockfile(content)
  const nested = packages.find(p => p.name === 'wrap-ansi')
  assert.ok(nested, 'nested wrap-ansi package not found')
  assert.equal(nested!.version, '7.0.0')
})

test('parses v1 lockfile format', () => {
  const content = readFileSync(
    join(fixturesDir, 'package-lock-v1.json'),
    'utf-8'
  )
  const packages = parseNpmLockfile(content)
  assert.equal(packages.length, 2)
  const semverPkg = packages.find(p => p.name === 'semver')
  assert.ok(semverPkg)
  assert.equal(semverPkg!.version, '7.6.3')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "npm" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/parsers/npm.ts**

```typescript
import type { Package } from '../types.js'

interface NpmLockV1 {
  lockfileVersion: 1
  dependencies?: Record<string, { version: string }>
}

interface NpmLockV23 {
  lockfileVersion: 2 | 3
  packages?: Record<string, { version?: string }>
}

type NpmLock = NpmLockV1 | NpmLockV23

export function parseNpmLockfile(content: string): Package[] {
  const lock = JSON.parse(content) as NpmLock

  if (lock.lockfileVersion >= 2) {
    const v23 = lock as NpmLockV23
    const result: Package[] = []

    for (const [key, pkg] of Object.entries(v23.packages ?? {})) {
      if (key === '') continue // skip root package entry
      if (!pkg.version) continue

      // Extract name from path: "node_modules/foo/node_modules/bar" → "bar"
      // Also handles scoped: "node_modules/@scope/foo" → "@scope/foo"
      const name = key.split('node_modules/').pop()!
      result.push({ name, version: pkg.version })
    }

    return result
  }

  // v1 format: flat dependencies hash
  const v1 = lock as NpmLockV1
  return Object.entries(v1.dependencies ?? {}).map(([name, dep]) => ({
    name,
    version: dep.version
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "npm" 2>&1
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/npm.ts test/parsers/npm.test.ts
git commit -m "feat: add npm lockfile parser"
```

---

## Task 6: Yarn Classic Parser

**Files:**

- Create: `src/parsers/yarn-classic.ts`
- Create: `test/parsers/yarn-classic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/parsers/yarn-classic.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnClassicLockfile } from '../../src/parsers/yarn-classic.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../fixtures')

test('parses yarn classic lockfile', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf-8')
  const packages = parseYarnClassicLockfile(content)

  assert.ok(packages.length >= 2)
  const semverPkg = packages.find(p => p.name === 'semver')
  assert.ok(semverPkg, 'semver not found')
  assert.equal(semverPkg!.version, '7.6.3')
})

test('deduplicates merged entries (comma-separated keys)', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf-8')
  const packages = parseYarnClassicLockfile(content)
  // fixture has "semver@^7.6.3, semver@^7.3.0" — should appear once
  const semverEntries = packages.filter(p => p.name === 'semver')
  assert.equal(semverEntries.length, 1)
})

test('handles scoped packages', () => {
  const content = [
    '# yarn lockfile v1',
    '',
    '"@babel/core@^7.0.0":',
    '  version "7.24.0"',
    '  resolved "https://registry.npmjs.org/@babel/core/-/core-7.24.0.tgz#abc"',
    '  integrity sha512-abc',
    ''
  ].join('\n')
  const packages = parseYarnClassicLockfile(content)
  const babelCore = packages.find(p => p.name === '@babel/core')
  assert.ok(babelCore, '@babel/core not found')
  assert.equal(babelCore!.version, '7.24.0')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "yarn classic" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/parsers/yarn-classic.ts**

```typescript
import * as lockfile from '@yarnpkg/lockfile'
import type { Package } from '../types.js'

function nameFromKey(key: string): string {
  // Keys can be "semver@^7.6.3" or "@babel/core@^7.0.0"
  // For merged entries: "semver@^7.6.3, semver@^7.3.0" — take the first
  const first = key.split(/,\s*/)[0].trim()
  // Match package name before the version specifier @
  // Handles scoped packages like @babel/core
  const match = first.match(/^(@[^/]+\/[^@]+|[^@]+)@/)
  return match ? match[1] : first
}

export function parseYarnClassicLockfile(content: string): Package[] {
  const result = lockfile.parse(content)

  if (result.type !== 'success') {
    throw new Error(`Failed to parse yarn.lock: ${result.type}`)
  }

  const seen = new Set<string>()
  const packages: Package[] = []

  for (const [key, entry] of Object.entries(result.object)) {
    const name = nameFromKey(key)
    // Deduplicate by name+version (merged entries resolve to the same package)
    const id = `${name}@${entry.version}`
    if (seen.has(id)) continue
    seen.add(id)
    packages.push({ name, version: entry.version })
  }

  return packages
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "yarn classic" 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/yarn-classic.ts test/parsers/yarn-classic.test.ts
git commit -m "feat: add yarn classic lockfile parser"
```

---

## Task 7: Yarn Berry Parser

**Files:**

- Create: `src/parsers/yarn-berry.ts`
- Create: `test/parsers/yarn-berry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/parsers/yarn-berry.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYarnBerryLockfile } from '../../src/parsers/yarn-berry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../fixtures')

test('parses yarn berry lockfile', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf-8')
  const packages = parseYarnBerryLockfile(content)

  assert.ok(packages.length >= 2)
  const semverPkg = packages.find(p => p.name === 'semver')
  assert.ok(semverPkg, 'semver not found')
  assert.equal(semverPkg!.version, '7.6.3')
})

test('skips __metadata entry', () => {
  const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf-8')
  const packages = parseYarnBerryLockfile(content)
  const meta = packages.find(p => p.name === '__metadata')
  assert.equal(meta, undefined)
})

test('handles scoped packages', () => {
  const content = [
    '__metadata:',
    '  version: 6',
    '  cacheKey: 8',
    '',
    '"@babel/core@npm:^7.0.0":',
    '  version: 7.24.0',
    '  resolution: "@babel/core@npm:7.24.0"',
    '  checksum: abc',
    '  languageName: node',
    '  linkType: hard',
    ''
  ].join('\n')
  const packages = parseYarnBerryLockfile(content)
  const babelCore = packages.find(p => p.name === '@babel/core')
  assert.ok(babelCore, '@babel/core not found')
  assert.equal(babelCore!.version, '7.24.0')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "yarn berry" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/parsers/yarn-berry.ts**

```typescript
import { parseSyml } from '@yarnpkg/parsers'
import type { Package } from '../types.js'

function nameFromBerryKey(key: string): string {
  // Key format: "semver@npm:^7.6.3" or "@babel/core@npm:^7.0.0"
  // Match everything before @<protocol>:
  const match = key.match(/^(.+?)@(?:npm|patch|portal|link|file|git):/)
  return match ? match[1] : key
}

export function parseYarnBerryLockfile(content: string): Package[] {
  const parsed = parseSyml(content) as Record<string, Record<string, string>>

  const seen = new Set<string>()
  const packages: Package[] = []

  for (const [key, entry] of Object.entries(parsed)) {
    if (key === '__metadata') continue
    if (!entry['version']) continue

    const name = nameFromBerryKey(key)
    const id = `${name}@${entry['version']}`
    if (seen.has(id)) continue
    seen.add(id)

    packages.push({ name, version: entry['version'] })
  }

  return packages
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "yarn berry" 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/yarn-berry.ts test/parsers/yarn-berry.test.ts
git commit -m "feat: add yarn berry lockfile parser"
```

---

## Task 8: pnpm Parser

**Files:**

- Create: `src/parsers/pnpm.ts`
- Create: `test/parsers/pnpm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/parsers/pnpm.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePnpmLockfile } from '../../src/parsers/pnpm.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../fixtures')

test('parses pnpm lockfile v6', () => {
  const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf-8')
  const packages = parsePnpmLockfile(content)

  assert.ok(packages.length >= 2)
  const semverPkg = packages.find(p => p.name === 'semver')
  assert.ok(semverPkg, 'semver not found')
  assert.equal(semverPkg!.version, '7.6.3')
})

test('extracts all packages from packages block', () => {
  const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf-8')
  const packages = parsePnpmLockfile(content)
  const names = packages.map(p => p.name)
  assert.ok(names.includes('semver'))
  assert.ok(names.includes('cliui'))
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "pnpm" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/parsers/pnpm.ts**

```typescript
import { parse } from 'yaml'
import type { Package } from '../types.js'

interface PnpmLock {
  lockfileVersion?: string | number
  packages?: Record<string, unknown>
  snapshots?: Record<string, unknown>
}

function nameAndVersionFromKey(
  key: string
): { name: string; version: string } | null {
  // pnpm v6: "/semver@7.6.3" or "/@babel/core@7.24.0"
  // pnpm v9: "semver@7.6.3" or "@babel/core@7.24.0" (no leading slash)
  // Also strip peer dep suffixes: "pkg@1.0.0(react@18.0.0)" → "pkg@1.0.0"
  const normalized = key.startsWith('/') ? key.slice(1) : key
  const withoutSuffix = normalized.replace(/\([^)]+\)/g, '')

  const match = withoutSuffix.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/)
  if (!match) return null
  return { name: match[1], version: match[2] }
}

export function parsePnpmLockfile(content: string): Package[] {
  const lock = parse(content) as PnpmLock

  // pnpm v9 uses 'snapshots', earlier versions use 'packages'
  const pkgMap = lock.snapshots ?? lock.packages ?? {}

  const seen = new Set<string>()
  const packages: Package[] = []

  for (const key of Object.keys(pkgMap)) {
    const parsed = nameAndVersionFromKey(key)
    if (!parsed) continue

    const id = `${parsed.name}@${parsed.version}`
    if (seen.has(id)) continue
    seen.add(id)

    packages.push({ name: parsed.name, version: parsed.version })
  }

  return packages
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "pnpm" 2>&1
```

Expected: all 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/pnpm.ts test/parsers/pnpm.test.ts
git commit -m "feat: add pnpm lockfile parser"
```

---

## Task 9: Lockfile Detector

**Files:**

- Create: `src/parsers/detect.ts`
- Create: `test/parsers/detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/parsers/detect.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectLockfile, detectYarnVersion } from '../../src/parsers/detect.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'semver-ranger-test-'))
}

test('detects package-lock.json with highest priority', () => {
  const dir = makeTempDir()
  try {
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}')
    writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1\n')
    const result = detectLockfile(dir)
    assert.ok(result)
    assert.equal(result!.type, 'npm')
    assert.equal(result!.manager, 'npm')
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('detects pnpm-lock.yaml when no package-lock.json', () => {
  const dir = makeTempDir()
  try {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: "6.0"\n')
    const result = detectLockfile(dir)
    assert.ok(result)
    assert.equal(result!.type, 'pnpm')
    assert.equal(result!.manager, 'pnpm')
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('detects yarn.lock classic', () => {
  const dir = makeTempDir()
  try {
    writeFileSync(
      join(dir, 'yarn.lock'),
      '# THIS IS AN AUTOGENERATED FILE.\n# yarn lockfile v1\n\nsemver@^7.6.3:\n  version "7.6.3"\n'
    )
    const result = detectLockfile(dir)
    assert.ok(result)
    assert.equal(result!.type, 'yarn-classic')
    assert.equal(result!.manager, 'yarn')
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('detects yarn.lock berry', () => {
  const dir = makeTempDir()
  try {
    writeFileSync(
      join(dir, 'yarn.lock'),
      '__metadata:\n  version: 6\n  cacheKey: 8\n'
    )
    const result = detectLockfile(dir)
    assert.ok(result)
    assert.equal(result!.type, 'yarn-berry')
    assert.equal(result!.manager, 'yarn')
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('returns null when no lockfile found', () => {
  const dir = makeTempDir()
  try {
    const result = detectLockfile(dir)
    assert.equal(result, null)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('detectYarnVersion distinguishes classic and berry', () => {
  assert.equal(
    detectYarnVersion('# yarn lockfile v1\n\nsemver@^7:\n  version "7.6.3"\n'),
    'yarn-classic'
  )
  assert.equal(detectYarnVersion('__metadata:\n  version: 6\n'), 'yarn-berry')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "detect" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/parsers/detect.ts**

```typescript
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DetectedLockfile, LockfileType, ManagerType } from '../types.js'

const LOCKFILE_PRIORITY: Array<{
  filename: string
  type: LockfileType | null
  manager: ManagerType
}> = [
  { filename: 'package-lock.json', type: 'npm', manager: 'npm' },
  { filename: 'pnpm-lock.yaml', type: 'pnpm', manager: 'pnpm' },
  { filename: 'yarn.lock', type: null, manager: 'yarn' }
]

export function detectYarnVersion(content: string): LockfileType {
  return content.includes('__metadata:') ? 'yarn-berry' : 'yarn-classic'
}

export function detectLockfile(dir: string): DetectedLockfile | null {
  for (const candidate of LOCKFILE_PRIORITY) {
    const filePath = join(dir, candidate.filename)
    if (!existsSync(filePath)) continue

    if (candidate.type !== null) {
      return {
        path: filePath,
        type: candidate.type,
        manager: candidate.manager
      }
    }

    // yarn.lock — detect version from first 512 bytes
    const content = readFileSync(filePath, 'utf-8').slice(0, 512)
    const type = detectYarnVersion(content)
    return { path: filePath, type, manager: 'yarn' }
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "detect" 2>&1
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/detect.ts test/parsers/detect.test.ts
git commit -m "feat: add lockfile detector"
```

---

## Task 10: Local Resolver

**Files:**

- Create: `src/registry/local.ts`
- Create: `test/registry/local.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/registry/local.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLocal } from '../../src/registry/local.js'
import type { Package } from '../../src/types.js'

function makeNodeModules(packages: Record<string, object>): {
  dir: string
  nmDir: string
} {
  const dir = mkdtempSync(join(tmpdir(), 'nm-test-'))
  const nmDir = join(dir, 'node_modules')
  for (const [name, pkgJson] of Object.entries(packages)) {
    const pkgDir = join(nmDir, name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkgJson))
  }
  return { dir, nmDir }
}

test('reads engines from node_modules', () => {
  const { dir, nmDir } = makeNodeModules({
    semver: { name: 'semver', version: '7.6.3', engines: { node: '>=10' } }
  })
  try {
    const input: Package[] = [{ name: 'semver', version: '7.6.3' }]
    const result = resolveLocal(input, nmDir)
    assert.deepEqual(result[0].engines, { node: '>=10' })
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('reads peerDependencies from node_modules', () => {
  const { dir, nmDir } = makeNodeModules({
    'some-plugin': {
      name: 'some-plugin',
      version: '1.0.0',
      peerDependencies: { react: '>=17' }
    }
  })
  try {
    const input: Package[] = [{ name: 'some-plugin', version: '1.0.0' }]
    const result = resolveLocal(input, nmDir)
    assert.deepEqual(result[0].peerDependencies, { react: '>=17' })
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('leaves package unchanged if not found in node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-test-'))
  const nmDir = join(dir, 'node_modules')
  try {
    mkdirSync(nmDir, { recursive: true })
    const input: Package[] = [{ name: 'missing-pkg', version: '1.0.0' }]
    const result = resolveLocal(input, nmDir)
    assert.equal(result[0].engines, undefined)
    assert.equal(result[0].peerDependencies, undefined)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "local" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/registry/local.ts**

```typescript
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Package } from '../types.js'

interface LocalPackageJson {
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export function resolveLocal(
  packages: Package[],
  nodeModulesDir: string
): Package[] {
  return packages.map(pkg => {
    const pkgJsonPath = join(nodeModulesDir, pkg.name, 'package.json')
    if (!existsSync(pkgJsonPath)) return pkg

    try {
      const pkgJson = JSON.parse(
        readFileSync(pkgJsonPath, 'utf-8')
      ) as LocalPackageJson
      return {
        ...pkg,
        engines: pkgJson.engines ?? pkg.engines,
        peerDependencies: pkgJson.peerDependencies ?? pkg.peerDependencies
      }
    } catch {
      return pkg
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "local" 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/registry/local.ts test/registry/local.test.ts
git commit -m "feat: add local node_modules resolver"
```

---

## Task 11: Cache

**Files:**

- Create: `src/cache/index.ts`
- Create: `test/cache/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/cache/index.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCache } from '../../src/cache/index.js'

function makeTempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'cache-test-'))
}

test('version cache miss returns undefined', () => {
  const dir = makeTempCacheDir()
  try {
    const cache = createCache(dir)
    assert.equal(cache.getVersion('missing-pkg@1.0.0'), undefined)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('stores and retrieves version-pinned data', () => {
  const dir = makeTempCacheDir()
  try {
    const cache = createCache(dir)
    const data = { engines: { node: '>=14' }, peerDependencies: {} }
    cache.setVersion('semver@7.6.3', data)
    const retrieved = cache.getVersion('semver@7.6.3')
    assert.deepEqual(retrieved, data)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('latest cache miss returns undefined', () => {
  const dir = makeTempCacheDir()
  try {
    const cache = createCache(dir)
    assert.equal(cache.getLatest('semver'), undefined)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('stores and retrieves latest data', () => {
  const dir = makeTempCacheDir()
  try {
    const cache = createCache(dir)
    const data = { version: '7.6.3', engines: { node: '>=10' } }
    cache.setLatest('semver', data)
    const retrieved = cache.getLatest('semver')
    assert.deepEqual(retrieved, data)
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('latest cache expires after TTL', async () => {
  const dir = makeTempCacheDir()
  try {
    const cache = createCache(dir, { latestTtlMs: 1 }) // 1ms TTL
    const data = { version: '7.6.3', engines: { node: '>=10' } }
    cache.setLatest('semver', data)
    await new Promise(resolve => setTimeout(resolve, 10))
    const retrieved = cache.getLatest('semver')
    assert.equal(retrieved, undefined, 'should have expired')
  } finally {
    rmSync(dir, { recursive: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "cache" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/cache/index.ts**

```typescript
import flatCache from 'flat-cache'
import envPaths from 'env-paths'
import { join } from 'node:path'

export interface ManifestData {
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface LatestData extends ManifestData {
  version: string
}

interface LatestEntry {
  data: LatestData
  cachedAt: number
}

export interface CacheOptions {
  latestTtlMs?: number
}

export interface Cache {
  getVersion(key: string): ManifestData | undefined
  setVersion(key: string, data: ManifestData): void
  getLatest(name: string): LatestData | undefined
  setLatest(name: string, data: LatestData): void
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function getCacheDir(): string {
  if (process.env['XDG_CACHE_HOME']) {
    return join(process.env['XDG_CACHE_HOME'], 'semver-ranger')
  }

  try {
    const paths = envPaths('semver-ranger', { suffix: '' })
    return paths.cache
  } catch {
    return join(process.env['HOME'] ?? '.', '.cache', 'semver-ranger')
  }
}

export function createCache(cacheDir?: string, opts: CacheOptions = {}): Cache {
  const dir = cacheDir ?? getCacheDir()
  const ttl = opts.latestTtlMs ?? DEFAULT_TTL_MS

  const versionsCache = flatCache.create({ cacheId: 'versions', cacheDir: dir })
  const latestCache = flatCache.create({ cacheId: 'latest', cacheDir: dir })

  return {
    getVersion(key: string): ManifestData | undefined {
      return versionsCache.get<ManifestData>(key)
    },

    setVersion(key: string, data: ManifestData): void {
      versionsCache.set(key, data)
      versionsCache.save()
    },

    getLatest(name: string): LatestData | undefined {
      const entry = latestCache.get<LatestEntry>(name)
      if (!entry) return undefined
      if (Date.now() - entry.cachedAt > ttl) {
        latestCache.remove(name)
        latestCache.save()
        return undefined
      }
      return entry.data
    },

    setLatest(name: string, data: LatestData): void {
      const entry: LatestEntry = { data, cachedAt: Date.now() }
      latestCache.set(name, entry)
      latestCache.save()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "cache" 2>&1
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cache/index.ts test/cache/index.test.ts
git commit -m "feat: add XDG-aware cache with TTL"
```

---

## Task 12: Registry Client

**Files:**

- Create: `src/registry/client.ts`
- Create: `test/registry/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/registry/client.test.ts`:

```typescript
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { Package } from '../../src/types.js'

// Mock global fetch before importing the module under test
const mockResponses = new Map<string, object>()

globalThis.fetch = mock.fn(async (url: RequestInfo | URL) => {
  const key = url.toString()
  const response = mockResponses.get(key)
  if (!response) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => response }
}) as unknown as typeof fetch

const { resolveRegistry } = await import('../../src/registry/client.js')

test('resolves engines from registry for current version', async () => {
  mockResponses.set('https://registry.npmjs.org/semver/7.6.3', {
    version: '7.6.3',
    engines: { node: '>=10' },
    peerDependencies: {}
  })
  mockResponses.set('https://registry.npmjs.org/semver/latest', {
    version: '7.7.0',
    engines: { node: '>=12' },
    peerDependencies: {}
  })

  const input: Package[] = [{ name: 'semver', version: '7.6.3' }]
  const result = await resolveRegistry(input)

  assert.deepEqual(result[0].engines, { node: '>=10' })
  assert.equal(result[0].latestVersion, '7.7.0')
  assert.deepEqual(result[0].latestEngines, { node: '>=12' })
})

test('handles registry fetch errors gracefully', async () => {
  mockResponses.clear()
  const input: Package[] = [{ name: 'no-such-pkg', version: '1.0.0' }]
  const result = await resolveRegistry(input)
  assert.equal(result[0].engines, undefined)
  assert.equal(result[0].latestVersion, undefined)
})

test('skips all fetches when offline is true', async () => {
  let fetchCalled = false
  globalThis.fetch = mock.fn(async () => {
    fetchCalled = true
    return { ok: true, status: 200, json: async () => ({}) }
  }) as unknown as typeof fetch

  const input: Package[] = [
    { name: 'semver', version: '7.6.3', engines: { node: '>=10' } }
  ]
  const result = await resolveRegistry(input, { offline: true })

  assert.equal(fetchCalled, false)
  assert.deepEqual(result[0].engines, { node: '>=10' }) // unchanged from input
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "registry client" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/registry/client.ts**

```typescript
import type { Package } from '../types.js'
import type { Cache, ManifestData, LatestData } from '../cache/index.js'

const REGISTRY_BASE = 'https://registry.npmjs.org'

interface RegistryManifest {
  version?: string
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface ResolveOptions {
  offline?: boolean
  cache?: Cache
  concurrency?: number
}

async function fetchManifest(
  name: string,
  version: string,
  cache?: Cache
): Promise<RegistryManifest | null> {
  const isLatest = version === 'latest'
  const cacheKey = `${name}@${version}`

  if (cache && !isLatest) {
    const cached = cache.getVersion(cacheKey)
    if (cached) return cached
  }

  if (cache && isLatest) {
    const cached = cache.getLatest(name)
    if (cached) return cached
  }

  try {
    // Encode scoped package names: @scope/name → @scope%2Fname
    const encodedName = name.startsWith('@')
      ? `@${encodeURIComponent(name.slice(1))}`
      : encodeURIComponent(name)
    const res = await fetch(`${REGISTRY_BASE}/${encodedName}/${version}`)
    if (!res.ok) return null

    const manifest = (await res.json()) as RegistryManifest

    if (cache) {
      const data: ManifestData = {
        engines: manifest.engines,
        peerDependencies: manifest.peerDependencies
      }
      if (isLatest && manifest.version) {
        cache.setLatest(name, {
          version: manifest.version,
          ...data
        } as LatestData)
      } else {
        cache.setVersion(cacheKey, data)
      }
    }

    return manifest
  } catch {
    return null
  }
}

export async function resolveRegistry(
  packages: Package[],
  opts: ResolveOptions = {}
): Promise<Package[]> {
  if (opts.offline) return packages

  const concurrency = opts.concurrency ?? 8
  const results: Package[] = []

  for (let i = 0; i < packages.length; i += concurrency) {
    const batch = packages.slice(i, i + concurrency)
    const resolved = await Promise.all(
      batch.map(async pkg => {
        const [current, latest] = await Promise.all([
          fetchManifest(pkg.name, pkg.version, opts.cache),
          fetchManifest(pkg.name, 'latest', opts.cache)
        ])

        return {
          ...pkg,
          engines: current?.engines ?? pkg.engines,
          peerDependencies: current?.peerDependencies ?? pkg.peerDependencies,
          latestVersion: latest?.version,
          latestEngines: latest?.engines,
          latestPeerDependencies: latest?.peerDependencies
        }
      })
    )
    results.push(...resolved)
  }

  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "registry client" 2>&1
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/registry/client.ts test/registry/client.test.ts
git commit -m "feat: add registry client with caching and offline support"
```

---

## Task 13: Engines Analyzer

**Files:**

- Create: `src/analyzer/engines.ts`
- Create: `test/analyzer/engines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/analyzer/engines.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import semver from 'semver'
import { analyzeEngines } from '../../src/analyzer/engines.js'
import type { Package } from '../../src/types.js'

const packages: Package[] = [
  {
    name: 'express',
    version: '4.18.2',
    engines: { node: '>=14.0.0' },
    latestEngines: { node: '>=18.0.0' }
  },
  {
    name: 'semver',
    version: '7.6.3',
    engines: { node: '>=10.0.0' },
    latestEngines: { node: '>=10.0.0' }
  },
  {
    name: 'no-engine-pkg',
    version: '1.0.0'
    // no engines field
  }
]

test('returns node target', () => {
  const targets = analyzeEngines(packages, 'npm')
  const node = targets.find(t => t.name === 'node')
  assert.ok(node, 'node target missing')
  assert.equal(node!.source, 'engines')
})

test('computes correct intersection for installed versions', () => {
  const targets = analyzeEngines(packages, 'npm')
  const node = targets.find(t => t.name === 'node')!
  // express >=14, semver >=10 → intersection is >=14
  assert.ok(node.intersection !== null)
  assert.ok(!semver.satisfies('13.0.0', node.intersection!))
  assert.ok(semver.satisfies('18.0.0', node.intersection!))
})

test('computes correct latest intersection', () => {
  const targets = analyzeEngines(packages, 'npm')
  const node = targets.find(t => t.name === 'node')!
  // express latest requires >=18 → latest intersection is >=18
  assert.ok(node.latestIntersection !== null)
  assert.ok(!semver.satisfies('17.0.0', node.latestIntersection!))
  assert.ok(semver.satisfies('20.0.0', node.latestIntersection!))
})

test('excludes packages with no engines declaration', () => {
  const targets = analyzeEngines(packages, 'npm')
  const node = targets.find(t => t.name === 'node')!
  const names = node.ranges.map(r => r.package)
  assert.ok(!names.includes('no-engine-pkg'))
})

test('includes manager engine target', () => {
  const packagesWithNpm: Package[] = [
    {
      name: 'some-pkg',
      version: '1.0.0',
      engines: { node: '>=14', npm: '>=7' }
    }
  ]
  const targets = analyzeEngines(packagesWithNpm, 'npm')
  const npmTarget = targets.find(t => t.name === 'npm')
  assert.ok(npmTarget, 'npm target missing')
  assert.equal(npmTarget!.ranges.length, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "engines" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/analyzer/engines.ts**

```typescript
import semver from 'semver'
import type {
  Package,
  AnalysisTarget,
  RangeEntry,
  ManagerType
} from '../types.js'
import { computeIntersection } from './intersect.js'

const MANAGER_ENGINE: Record<ManagerType, string> = {
  npm: 'npm',
  yarn: 'yarn',
  pnpm: 'pnpm'
}

function collectRanges(
  packages: Package[],
  engineKey: string,
  useLatest: boolean
): RangeEntry[] {
  const ranges: RangeEntry[] = []
  for (const pkg of packages) {
    const engines = useLatest ? pkg.latestEngines : pkg.engines
    const range = engines?.[engineKey]
    if (!range || range === '*') continue
    if (!semver.validRange(range)) continue
    ranges.push({
      package: pkg.name,
      version: useLatest ? (pkg.latestVersion ?? pkg.version) : pkg.version,
      range
    })
  }
  return ranges
}

export function analyzeEngines(
  packages: Package[],
  manager: ManagerType
): AnalysisTarget[] {
  const engineTargets = ['node', MANAGER_ENGINE[manager]]

  return engineTargets.map(target => {
    const ranges = collectRanges(packages, target, false)
    const latestRanges = collectRanges(packages, target, true)
    const { intersection, conflicts } = computeIntersection(ranges)
    const { intersection: latestIntersection, conflicts: latestConflicts } =
      computeIntersection(latestRanges)

    return {
      name: target,
      source: 'engines' as const,
      ranges,
      intersection,
      conflicts,
      latestRanges,
      latestIntersection,
      latestConflicts
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "engines" 2>&1
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/engines.ts test/analyzer/engines.test.ts
git commit -m "feat: add engines analyzer"
```

---

## Task 14: Peers Analyzer

**Files:**

- Create: `src/analyzer/peers.ts`
- Create: `test/analyzer/peers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/analyzer/peers.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzePeers,
  detectPeerTargets,
  WELL_KNOWN_PEERS
} from '../../src/analyzer/peers.js'
import type { Package } from '../../src/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../fixtures')

const packages: Package[] = [
  {
    name: 'react-query',
    version: '5.0.0',
    peerDependencies: { react: '>=17.0.0' },
    latestPeerDependencies: { react: '>=18.0.0' }
  },
  {
    name: 'react-router',
    version: '6.0.0',
    peerDependencies: { react: '>=16.8.0' },
    latestPeerDependencies: { react: '>=18.0.0' }
  },
  {
    name: 'no-peers-pkg',
    version: '1.0.0'
  }
]

test('returns analysis target for each specified target', () => {
  const targets = analyzePeers(packages, ['react'])
  assert.equal(targets.length, 1)
  assert.equal(targets[0].name, 'react')
  assert.equal(targets[0].source, 'peerDependencies')
})

test('computes correct intersection for installed peer ranges', () => {
  const targets = analyzePeers(packages, ['react'])
  const reactTarget = targets[0]
  // react-query >=17, react-router >=16.8 → intersection is >=17
  assert.ok(reactTarget.intersection !== null)
  assert.equal(reactTarget.ranges.length, 2)
})

test('excludes packages with no peer dep for target', () => {
  const targets = analyzePeers(packages, ['react'])
  const names = targets[0].ranges.map(r => r.package)
  assert.ok(!names.includes('no-peers-pkg'))
})

test('detectPeerTargets finds well-known packages from project package.json', () => {
  const targets = detectPeerTargets(fixturesDir)
  // test/fixtures/package.json has react and typescript
  assert.ok(targets.includes('react'), 'react not detected')
  assert.ok(targets.includes('typescript'), 'typescript not detected')
})

test('detectPeerTargets merges extra --check targets', () => {
  const targets = detectPeerTargets(fixturesDir, ['webpack'])
  assert.ok(targets.includes('webpack'))
})

test('detectPeerTargets deduplicates entries', () => {
  const targets = detectPeerTargets(fixturesDir, ['react'])
  const reactCount = targets.filter(t => t === 'react').length
  assert.equal(reactCount, 1)
})

test('WELL_KNOWN_PEERS includes expected packages', () => {
  assert.ok(WELL_KNOWN_PEERS.includes('react'))
  assert.ok(WELL_KNOWN_PEERS.includes('typescript'))
  assert.ok(WELL_KNOWN_PEERS.includes('vite'))
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "peers" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/analyzer/peers.ts**

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import type { Package, AnalysisTarget, RangeEntry } from '../types.js'
import { computeIntersection } from './intersect.js'

export const WELL_KNOWN_PEERS = [
  'typescript',
  'react',
  'react-dom',
  'vue',
  'svelte',
  'webpack',
  'vite',
  'rollup',
  'esbuild',
  'jest',
  'vitest',
  'next',
  'nuxt',
  'astro'
] as const

interface ProjectPackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function detectPeerTargets(
  projectDir: string,
  extraChecks: string[] = []
): string[] {
  try {
    const raw = readFileSync(join(projectDir, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as ProjectPackageJson
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const detected = (WELL_KNOWN_PEERS as readonly string[]).filter(
      p => p in allDeps
    )
    return [...new Set([...detected, ...extraChecks])]
  } catch {
    return [...new Set(extraChecks)]
  }
}

function collectRanges(
  packages: Package[],
  target: string,
  useLatest: boolean
): RangeEntry[] {
  const ranges: RangeEntry[] = []
  for (const pkg of packages) {
    const peers = useLatest ? pkg.latestPeerDependencies : pkg.peerDependencies
    const range = peers?.[target]
    if (!range || range === '*') continue
    if (!semver.validRange(range)) continue
    ranges.push({
      package: pkg.name,
      version: useLatest ? (pkg.latestVersion ?? pkg.version) : pkg.version,
      range
    })
  }
  return ranges
}

export function analyzePeers(
  packages: Package[],
  targets: string[]
): AnalysisTarget[] {
  return targets.map(target => {
    const ranges = collectRanges(packages, target, false)
    const latestRanges = collectRanges(packages, target, true)
    const { intersection, conflicts } = computeIntersection(ranges)
    const { intersection: latestIntersection, conflicts: latestConflicts } =
      computeIntersection(latestRanges)

    return {
      name: target,
      source: 'peerDependencies' as const,
      ranges,
      intersection,
      conflicts,
      latestRanges,
      latestIntersection,
      latestConflicts
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "peers" 2>&1
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/peers.ts test/analyzer/peers.test.ts
git commit -m "feat: add peer dependency analyzer with auto-detection"
```

---

## Task 15: Output Renderer

**Files:**

- Create: `src/output/table.ts`
- Create: `test/output/table.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/output/table.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderTargets,
  renderJson,
  renderHeader
} from '../../src/output/table.js'
import type { AnalysisTarget } from '../../src/types.js'

const targets: AnalysisTarget[] = [
  {
    name: 'node',
    source: 'engines',
    ranges: [
      { package: 'express', version: '4.18.2', range: '>=14.0.0' },
      { package: 'semver', version: '7.6.3', range: '>=10.0.0' }
    ],
    intersection: '>=14.0.0',
    conflicts: [],
    latestRanges: [{ package: 'express', version: '5.0.0', range: '>=18.0.0' }],
    latestIntersection: '>=18.0.0',
    latestConflicts: []
  }
]

test('renderJson returns valid JSON array', () => {
  const output = renderJson(targets)
  const parsed = JSON.parse(output) as AnalysisTarget[]
  assert.ok(Array.isArray(parsed))
  assert.equal(parsed[0].name, 'node')
  assert.equal(parsed[0].intersection, '>=14.0.0')
})

test('renderTargets returns non-empty string', () => {
  const output = renderTargets(targets, { all: false, totalPackages: 10 })
  assert.ok(typeof output === 'string')
  assert.ok(output.length > 0)
})

test('renderTargets includes target name', () => {
  const output = renderTargets(targets, { all: false, totalPackages: 10 })
  assert.ok(output.includes('node'))
})

test('renderTargets includes intersection range', () => {
  const output = renderTargets(targets, { all: false, totalPackages: 10 })
  assert.ok(output.includes('>=14.0.0'))
})

test('renderTargets shows conflict package when conflicts exist', () => {
  const withConflicts: AnalysisTarget[] = [
    {
      ...targets[0],
      latestConflicts: [
        { package: 'old-pkg', version: '1.0.0', range: '<12.0.0' }
      ],
      latestIntersection: null
    }
  ]
  const output = renderTargets(withConflicts, { all: false, totalPackages: 10 })
  assert.ok(output.includes('old-pkg'))
})

test('renderHeader includes lockfile path and targets', () => {
  const output = renderHeader('package-lock.json', 'npm', ['node', 'npm'], 247)
  assert.ok(output.includes('package-lock.json'))
  assert.ok(output.includes('247'))
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern "output" 2>&1 | head -10
```

Expected: module not found error.

- [ ] **Step 3: Create src/output/table.ts**

```typescript
import cliui from 'cliui'
import type { AnalysisTarget, RangeEntry } from '../types.js'

const WIDTH = process.stdout.columns || 80
const SEPARATOR = '─'.repeat(WIDTH)
const SUB_SEP = '─'.repeat(Math.min(WIDTH - 4, 60))

const COL = { pkg: 28, installed: 12, latest: 12, range: 24 }

export interface RenderOptions {
  all: boolean
  totalPackages: number
}

function packageRow(
  ui: ReturnType<typeof cliui>,
  entry: RangeEntry,
  latestVersion: string,
  prefix = '  '
): void {
  ui.div(
    { text: prefix + entry.package, width: COL.pkg },
    { text: entry.version, width: COL.installed },
    { text: latestVersion, width: COL.latest },
    { text: entry.range, width: COL.range }
  )
}

function renderTarget(target: AnalysisTarget, opts: RenderOptions): string {
  const ui = cliui({ width: WIDTH })
  const count = target.ranges.length

  // Section header
  ui.div(
    { text: `  ${target.name} (${target.source})`, width: WIDTH - 44 },
    {
      text: `${count} of ${opts.totalPackages} packages declare a constraint`,
      align: 'right',
      width: 44
    }
  )
  ui.div(`  ${SUB_SEP}`)

  // Summary
  ui.div(
    { text: '  Safe range (installed):', width: 30 },
    { text: target.intersection ?? '⚠  no compatible range', width: WIDTH - 30 }
  )
  ui.div(
    { text: '  Safe range (latest):', width: 30 },
    {
      text: target.latestIntersection ?? '⚠  no compatible range',
      width: WIDTH - 30
    }
  )

  if (target.ranges.length > 0 || opts.all) {
    ui.div('')
    // Column headers
    ui.div(
      { text: '  Package', width: COL.pkg },
      { text: 'Installed', width: COL.installed },
      { text: 'Latest', width: COL.latest },
      { text: 'Range (installed)', width: COL.range }
    )

    for (const entry of target.ranges) {
      const matchingLatest = target.latestRanges.find(
        r => r.package === entry.package
      )
      packageRow(ui, entry, matchingLatest?.version ?? '')
    }
  }

  // Conflict section
  if (target.latestConflicts.length > 0) {
    ui.div('')
    ui.div({
      text: `  ⚠  Conflicts at latest (${target.latestConflicts.length} package(s) would block upgrade):`
    })
    for (const entry of target.latestConflicts) {
      packageRow(ui, entry, entry.version)
    }
  }

  return ui.toString()
}

export function renderTargets(
  targets: AnalysisTarget[],
  opts: RenderOptions
): string {
  const active = targets.filter(t => t.ranges.length > 0 || opts.all)
  return active.map(t => renderTarget(t, opts)).join(`\n${SEPARATOR}\n\n`)
}

export function renderHeader(
  lockfilePath: string,
  manager: string,
  targetNames: string[],
  totalPackages: number
): string {
  const ui = cliui({ width: WIDTH })
  ui.div(`semver-ranger — analyzing ${totalPackages} packages`)
  ui.div('')
  ui.div({ text: '  Lockfile:', width: 14 }, { text: lockfilePath })
  ui.div({ text: '  Manager:', width: 14 }, { text: manager })
  ui.div({ text: '  Targets:', width: 14 }, { text: targetNames.join(', ') })
  return ui.toString()
}

export function renderJson(targets: AnalysisTarget[]): string {
  return JSON.stringify(targets, null, 2)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern "output" 2>&1
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/output/table.ts test/output/table.test.ts
git commit -m "feat: add cliui output renderer"
```

---

## Task 16: CLI Orchestration

**Files:**

- Modify: `src/cli.ts`

- [ ] **Step 1: Replace src/cli.ts with the full implementation**

```typescript
#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

import { detectLockfile } from './parsers/detect.js'
import { parseNpmLockfile } from './parsers/npm.js'
import { parseYarnClassicLockfile } from './parsers/yarn-classic.js'
import { parseYarnBerryLockfile } from './parsers/yarn-berry.js'
import { parsePnpmLockfile } from './parsers/pnpm.js'
import { resolveLocal } from './registry/local.js'
import { resolveRegistry } from './registry/client.js'
import { createCache, getCacheDir } from './cache/index.js'
import { analyzeEngines } from './analyzer/engines.js'
import { analyzePeers, detectPeerTargets } from './analyzer/peers.js'
import { renderHeader, renderTargets, renderJson } from './output/table.js'
import type { Package, LockfileType, ManagerType } from './types.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const HELP = `
Usage: semver-ranger [lockfile-path] [options]

Options:
  --offline          Skip registry; use node_modules + cache only
  --check <pkg>      Add a package to peer dep analysis (repeatable)
  --no-dev           Exclude devDependencies from analysis
  --all              Show all packages, including those without constraints
  --json             Output raw JSON
  --version          Print version and exit
  --help             Print this help and exit
`.trim()

function parseLockfile(type: LockfileType, content: string): Package[] {
  switch (type) {
    case 'npm':
      return parseNpmLockfile(content)
    case 'yarn-classic':
      return parseYarnClassicLockfile(content)
    case 'yarn-berry':
      return parseYarnBerryLockfile(content)
    case 'pnpm':
      return parsePnpmLockfile(content)
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      offline: { type: 'boolean', default: false },
      check: { type: 'string', multiple: true, default: [] },
      'no-dev': { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    },
    allowPositionals: true
  })

  if (values.version) {
    console.log(`semver-ranger ${version}`)
    process.exit(0)
  }

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }

  // Determine search directory from positional arg or cwd
  const startDir = positionals[0] ? resolve(positionals[0]) : process.cwd()
  const searchDir = existsSync(startDir) ? startDir : process.cwd()

  const detected = detectLockfile(searchDir)
  if (!detected) {
    console.error(
      'Error: no lockfile found (package-lock.json, pnpm-lock.yaml, or yarn.lock)'
    )
    process.exit(1)
  }

  // Parse lockfile
  const content = readFileSync(detected.path, 'utf-8')
  let packages = parseLockfile(detected.type, content)

  // Resolve local node_modules data
  const nodeModulesDir = resolve(dirname(detected.path), 'node_modules')
  packages = resolveLocal(packages, nodeModulesDir)

  // Resolve registry data
  if (!values.offline) {
    const cache = createCache(getCacheDir())
    packages = await resolveRegistry(packages, { cache })
  }

  // Map lockfile type to manager type
  const managerMap: Record<LockfileType, ManagerType> = {
    npm: 'npm',
    'yarn-classic': 'yarn',
    'yarn-berry': 'yarn',
    pnpm: 'pnpm'
  }
  const manager = managerMap[detected.type]

  // Analyze engines (node + package manager)
  const engineTargets = analyzeEngines(packages, manager)

  // Analyze peer dependencies (auto-detected + --check)
  const projectDir = dirname(detected.path)
  const peerTargetNames = detectPeerTargets(
    projectDir,
    (values.check ?? []) as string[]
  )
  const peerTargets = analyzePeers(packages, peerTargetNames)

  const allTargets = [...engineTargets, ...peerTargets]

  // Render output
  if (values.json) {
    console.log(renderJson(allTargets))
    process.exit(0)
  }

  console.log(
    renderHeader(
      detected.path,
      manager,
      allTargets.map(t => t.name),
      packages.length
    )
  )
  console.log()
  console.log(
    renderTargets(allTargets, {
      all: Boolean(values.all),
      totalPackages: packages.length
    })
  )
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

- [ ] **Step 2: Build the project**

```bash
npm run build
```

Expected: `dist/cli.js` created, exit 0.

- [ ] **Step 3: Smoke test the CLI**

```bash
node dist/cli.js --version
```

Expected: `semver-ranger 1.0.0`

```bash
node dist/cli.js --help
```

Expected: usage text printed.

```bash
node dist/cli.js --offline --json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');JSON.parse(d);console.log('valid JSON')"
```

Expected: `valid JSON` (may be empty array `[]` if no engines in current project's node_modules).

- [ ] **Step 4: Run the full test suite**

```bash
npm test 2>&1
```

Expected: all tests pass, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: implement CLI pipeline orchestration"
```

---

## Task 17: Cleanup

**Files:**

- Delete: `index.js`
- Delete: `lib/parser.js` and `lib/` directory
- Modify: `package.json` (remove `package-lock-parser`)
- Modify: `eslint.config.mjs` (remove index.js rule override)
- Modify: `.gitignore` (ensure `dist/` is present)

- [ ] **Step 1: Remove old files**

```bash
rm index.js lib/parser.js && rmdir lib
```

- [ ] **Step 2: Remove package-lock-parser from package.json dependencies**

Edit `package.json` and remove the `"package-lock-parser": "^1.0.0"` line from `"dependencies"`.

- [ ] **Step 3: Update eslint.config.mjs to remove the index.js override**

```javascript
import ivuorinenConfig from '@ivuorinen/eslint-config'
import tseslint from 'typescript-eslint'

export default [
  ...ivuorinenConfig,
  ...tseslint.configs.recommended,

  {
    ignores: ['*.yml', 'dist/**']
  },

  {
    rules: {
      'max-len': ['warn', { code: 100 }]
    }
  }
]
```

- [ ] **Step 4: Ensure dist/ is in .gitignore**

Open `.gitignore` and verify `dist/` is present. If not, add it.

- [ ] **Step 5: Run npm install to remove package-lock-parser**

```bash
npm install
```

Expected: `package-lock-parser` removed, lock file updated.

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1
```

Expected: all tests pass, exit 0.

- [ ] **Step 7: Run lint**

```bash
npm run lint
```

Expected: exit 0, no errors.

- [ ] **Step 8: Final build and smoke test**

```bash
npm run build && node dist/cli.js --version
```

Expected: prints `semver-ranger 1.0.0`.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore: remove old CJS files and package-lock-parser dependency"
```

---

## Spec Coverage Checklist

- ✅ TypeScript + tsup build (Task 1)
- ✅ Shared types with `latestEngines`/`latestPeerDeps` (Task 2)
- ✅ npm lockfile parser v1/v2/v3 (Task 5)
- ✅ yarn classic parser (Task 6)
- ✅ yarn berry parser (Task 7)
- ✅ pnpm parser v6/v9 (Task 8)
- ✅ Lockfile detector with priority order (Task 9)
- ✅ Local node_modules resolver (Task 10)
- ✅ Cache with XDG path resolution + TTL (Task 11)
- ✅ Registry client with concurrency + caching (Task 12)
- ✅ Engines analyzer: node + manager target (Task 13)
- ✅ Peers analyzer: auto-detect + `--check` (Task 14)
- ✅ cliui output: installed vs latest comparison (Task 15)
- ✅ `--offline`, `--check`, `--no-dev`, `--all`, `--json` flags (Task 16)
- ✅ Cleanup of old CJS files (Task 17)
- ✅ All network calls mocked in tests (Tasks 12, 16)
- ✅ No `execSync`/`exec` — cache uses env-paths only (Task 11)
