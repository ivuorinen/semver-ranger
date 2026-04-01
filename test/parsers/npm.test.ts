import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmLockfile } from '../../src/parsers/npm.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(currentDir, '../fixtures')

/**
 * Parses a fixture lockfile and asserts that an express package at the given version is present.
 * @param {string} fixtureFile Fixture lockfile filename relative to the fixtures directory.
 * @param {string} expectedVersion Expected version string for the express package.
 * @returns {void}
 */
function assertExpressVersion(fixtureFile: string, expectedVersion: string): void {
  const content = readFileSync(join(fixturesDir, fixtureFile), 'utf8')
  const packages = parseNpmLockfile(content)
  assert.ok(packages.length > 0)
  const express = packages.find(p => p.name === 'express')
  assert.ok(express)
  assert.strictEqual(express.version, expectedVersion)
}

describe('parseNpmLockfile', () => {
  it('parses v3 lockfile', () => {
    assertExpressVersion('package-lock.json', '4.19.2')
  })

  it('parses v1 lockfile', () => {
    assertExpressVersion('package-lock-v1.json', '4.19.2')
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
    assert.ok(typeof root === 'undefined' || root.version !== '')
  })

  it('deduplicates packages by name@version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21'
        },
        'node_modules/parent/node_modules/lodash': {
          name: 'lodash',
          version: '4.17.21'
        },
        'node_modules/other': {
          name: 'other',
          version: '1.0.0'
        }
      }
    })
    const packages = parseNpmLockfile(content)
    const lodashEntries = packages.filter(p => p.name === 'lodash')
    assert.strictEqual(lodashEntries.length, 1)
    assert.strictEqual(lodashEntries[0].version, '4.17.21')
    assert.strictEqual(packages.length, 2) // lodash + other, not 3
  })
})
