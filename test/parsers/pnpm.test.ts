import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePnpmLockfile } from '../../src/parsers/pnpm.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('parsePnpmLockfile', () => {
  it('parses pnpm v6 lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('extracts engines from pnpm lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express?.engines?.node)
  })

  it('handles package with no engines field', () => {
    const content = [
      `lockfileVersion: '6.0'`,
      `packages:`,
      `  /lodash@4.17.21:`,
      `    resolution: { integrity: sha512-abc }`
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const lodash = packages.find(p => p.name === 'lodash')
    assert.ok(lodash)
    assert.ok(typeof lodash.engines === 'undefined')
  })

  it('extracts peerDependencies from pnpm lockfile', () => {
    const content = [
      `lockfileVersion: '6.0'`,
      `packages:`,
      `  /react-dom@18.0.0:`,
      `    resolution: { integrity: sha512-abc }`,
      `    peerDependencies:`,
      `      react: ^18.0.0`
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const reactDom = packages.find(p => p.name === 'react-dom')
    assert.ok(reactDom)
    assert.strictEqual(reactDom.peerDependencies?.react, '^18.0.0')
  })

  it('skips keys that cannot be parsed', () => {
    const content = [
      `lockfileVersion: '6.0'`,
      `packages:`,
      `  invalid-key-no-version:`,
      `    resolution: { integrity: sha512-abc }`
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    assert.ok(!packages.some(p => p.name === 'invalid-key-no-version'))
  })

  it('deduplicates packages with same name and version', () => {
    const content = [
      `lockfileVersion: '6.0'`,
      `packages:`,
      `  /lodash@4.17.21:`,
      `    resolution: { integrity: sha512-abc }`,
      `  /lodash@4.17.21(peer@1.0.0):`,
      `    resolution: { integrity: sha512-abc }`
    ].join('\n')
    const packages = parsePnpmLockfile(content)
    const lodashEntries = packages.filter(p => p.name === 'lodash')
    assert.strictEqual(lodashEntries.length, 1)
  })

  it('extracts engines from pnpm v9 lockfile (packages block)', () => {
    const content = readFileSync(join(fixturesDir, 'pnpm-lock-v9.yaml'), 'utf8')
    const packages = parsePnpmLockfile(content)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express, 'express package found')
    assert.strictEqual(express.engines?.node, '>= 0.10.0')
  })
})
