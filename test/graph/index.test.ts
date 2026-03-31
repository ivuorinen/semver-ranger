import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterDevPackages, buildEdgeMap } from '../../src/graph/index.js'
import type { Package } from '../../src/types.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

// express is a prod dep, body-parser is its transitive dep, typescript is a dev dep
const allPackages: Package[] = [
  { name: 'express', version: '4.18.2' },
  { name: 'body-parser', version: '1.20.1' },
  { name: 'typescript', version: '5.0.4' }
]

describe('filterDevPackages', () => {
  it('excludes packages only reachable via devDependencies (npm)', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const result = filterDevPackages(allPackages, fixturesDir, content, 'npm')
    const names = new Set(result.map(p => p.name))
    assert.ok(names.has('express'), 'express kept (prod dep)')
    assert.ok(!names.has('typescript'), 'typescript excluded (dev dep)')
  })

  it('excludes packages only reachable via devDependencies (pnpm)', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const result = filterDevPackages(allPackages, fixturesDir, content, 'pnpm')
    const names = new Set(result.map(p => p.name))
    assert.ok(names.has('express'), 'express kept')
    assert.ok(!names.has('typescript'), 'typescript excluded')
  })

  it('retains packages shared between prod and dev', () => {
    const sharedDir = join(fixturesDir, 'graph-shared')
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const shared: Package[] = [
      { name: 'express', version: '4.18.2' },
      { name: 'typescript', version: '5.0.4' }
    ]
    const result = filterDevPackages(shared, sharedDir, content, 'npm')
    const names = result.map(p => p.name)
    assert.ok(names.includes('typescript'), 'typescript retained when also a prod dep')
  })

  it('returns packages unchanged when package.json not found', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const result = filterDevPackages(allPackages, '/nonexistent/path/xyz', content, 'npm')
    assert.strictEqual(result.length, allPackages.length)
  })

  it('npm v1 lockfile: follows requires edges', () => {
    const v1Content = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        express: { version: '4.18.2', requires: { 'body-parser': '1.20.1' } },
        'body-parser': { version: '1.20.1', requires: {} },
        typescript: { version: '5.0.4', requires: {} }
      }
    })
    // fixturesDir has package.json with express as prod dep, typescript as devDep
    const result = filterDevPackages(allPackages, fixturesDir, v1Content, 'npm')
    const names = new Set(result.map(p => p.name))
    assert.ok(names.has('express'), 'express retained (prod dep)')
    assert.ok(names.has('body-parser'), 'body-parser retained (transitive prod)')
    assert.ok(!names.has('typescript'), 'typescript excluded (dev only)')
  })

  it('yarn-classic: excludes dev-only packages', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-classic.lock'), 'utf8')
    // fixturesDir/package.json: express+react=prod, typescript+vite=dev
    const result = filterDevPackages(allPackages, fixturesDir, content, 'yarn-classic')
    const names = new Set(result.map(p => p.name))
    assert.ok(names.has('express'), 'express retained')
    assert.ok(!names.has('typescript'), 'typescript excluded')
  })

  it('yarn-berry: excludes dev-only packages using package.json roots (no lockfile edges)', () => {
    const content = readFileSync(join(fixturesDir, 'yarn-berry.lock'), 'utf8')
    // yarn-berry buildEdgeMap is a no-op (empty edge map), but filterDevPackages
    // still uses package.json roots: typescript is a devDep root and not in prod,
    // so it is excluded even without lockfile edge data.
    const result = filterDevPackages(allPackages, fixturesDir, content, 'yarn-berry')
    const names = new Set(result.map(p => p.name))
    assert.ok(names.has('express'), 'express retained (prod dep root)')
    assert.ok(!names.has('typescript'), 'typescript excluded (dev dep root)')
  })

  it('returns all packages when projectDir has no package.json', () => {
    const packages = [{ name: 'express', version: '4.18.2' }]
    const result = filterDevPackages(packages, '/nonexistent-12345', '{}', 'npm')
    assert.deepStrictEqual(result, packages)
  })

  it('yarn-classic: scoped packages appear as keys in edge map', () => {
    const yarnClassicContent = [
      '"@scope/pkg@^1.0.0":',
      '  version "1.0.0"',
      '  resolved "https://registry.example.com/@scope/pkg/-/pkg-1.0.0.tgz"',
      '  dependencies:',
      '    lodash "^4.0.0"',
      '',
      'lodash@^4.0.0:',
      '  version "4.17.21"',
      '  resolved "https://registry.example.com/lodash/-/lodash-4.17.21.tgz"'
    ].join('\n')

    const edges = buildEdgeMap(yarnClassicContent, 'yarn-classic')
    assert.ok(edges.has('@scope/pkg'), '@scope/pkg must appear as a key in the edge map')
    assert.deepStrictEqual(edges.get('@scope/pkg'), ['lodash'])
  })
})
