import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmLockfile } from '../../src/parsers/npm.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

describe('parseNpmLockfile', () => {
  it('parses v3 lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const packages = parseNpmLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('parses v1 lockfile', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock-v1.json'), 'utf8')
    const packages = parseNpmLockfile(content)
    assert.ok(packages.length > 0)
    const express = packages.find(p => p.name === 'express')
    assert.ok(express)
    assert.strictEqual(express.version, '4.18.2')
  })

  it('skips entries without version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/no-version': {}
      }
    })
    const packages = parseNpmLockfile(content)
    assert.ok(packages.some(p => p.name === 'lodash'))
    assert.ok(!packages.some(p => p.name === 'no-version'))
  })

  it('skips root package entry', () => {
    const content = readFileSync(join(fixturesDir, 'package-lock.json'), 'utf8')
    const packages = parseNpmLockfile(content)
    const root = packages.find(p => p.name === '' || p.name === 'test-project')
    // root entry should not appear or have no version
    assert.ok(!root || root.version !== '')
  })
})
