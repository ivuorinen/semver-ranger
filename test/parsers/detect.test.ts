import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, before, after } from 'node:test'
import { detectLockfile, isYarnBerry } from '../../src/parsers/detect.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const tmpBase = join(currentDir, '../../.tmp-detect-test')

describe('detectLockfile', () => {
  before(() => {
    mkdirSync(join(tmpBase, 'npm-project'), { recursive: true })
    writeFileSync(join(tmpBase, 'npm-project', 'package-lock.json'), '{"lockfileVersion":3}')

    mkdirSync(join(tmpBase, 'pnpm-project'), { recursive: true })
    writeFileSync(join(tmpBase, 'pnpm-project', 'pnpm-lock.yaml'), 'lockfileVersion: "6.0"\n')

    mkdirSync(join(tmpBase, 'yarn-classic-project'), { recursive: true })
    writeFileSync(join(tmpBase, 'yarn-classic-project', 'yarn.lock'), '# yarn lockfile v1\n')

    mkdirSync(join(tmpBase, 'yarn-berry-project'), { recursive: true })
    writeFileSync(join(tmpBase, 'yarn-berry-project', 'yarn.lock'), '__metadata:\n  version: 6\n')
  })

  after(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  it('detects npm lockfile', () => {
    const result = detectLockfile(join(tmpBase, 'npm-project'))
    assert.ok(result)
    assert.strictEqual(result.type, 'npm')
    assert.strictEqual(result.manager, 'npm')
  })

  it('detects pnpm lockfile', () => {
    const result = detectLockfile(join(tmpBase, 'pnpm-project'))
    assert.ok(result)
    assert.strictEqual(result.type, 'pnpm')
    assert.strictEqual(result.manager, 'pnpm')
  })

  it('detects yarn classic', () => {
    const result = detectLockfile(join(tmpBase, 'yarn-classic-project'))
    assert.ok(result)
    assert.strictEqual(result.type, 'yarn-classic')
    assert.strictEqual(result.manager, 'yarn')
  })

  it('detects yarn berry', () => {
    const result = detectLockfile(join(tmpBase, 'yarn-berry-project'))
    assert.ok(result)
    assert.strictEqual(result.type, 'yarn-berry')
    assert.strictEqual(result.manager, 'yarn')
  })

  it('returns null when no lockfile found', () => {
    mkdirSync(join(tmpBase, 'empty'), { recursive: true })
    const result = detectLockfile(join(tmpBase, 'empty'))
    assert.strictEqual(result, null)
  })
})

describe('isYarnBerry', () => {
  it('detects a berry lockfile from its header', () => {
    const dir = join(tmpBase, 'berry')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'yarn.lock')
    writeFileSync(file, '# yarn lockfile v1\n\n__metadata:\n  version: 6\n')
    assert.strictEqual(isYarnBerry(file), true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads only the header, not the whole file', () => {
    const dir = join(tmpBase, 'classic')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'yarn.lock')
    // __metadata: appears far past the 512-byte header and must not be matched.
    writeFileSync(file, `# yarn lockfile v1\n${'#'.repeat(2000)}\n__metadata:\n`)
    assert.strictEqual(isYarnBerry(file), false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns false for a missing file', () => {
    assert.strictEqual(isYarnBerry(join(tmpBase, 'does-not-exist.lock')), false)
  })
})
