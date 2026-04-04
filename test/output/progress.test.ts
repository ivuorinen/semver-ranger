import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { createPhaseSpinner, createBatchProgress } from '../../src/output/progress.js'

let originalIsTTY: boolean | undefined

beforeEach(() => {
  originalIsTTY = process.stderr.isTTY
  process.stderr.isTTY = false as never
})

afterEach(() => {
  process.stderr.isTTY = originalIsTTY as never
})

describe('createPhaseSpinner', () => {
  it('returns an object with succeed, fail, and update methods', () => {
    const spinner = createPhaseSpinner('test')
    assert.strictEqual(typeof spinner.succeed, 'function')
    assert.strictEqual(typeof spinner.fail, 'function')
    assert.strictEqual(typeof spinner.update, 'function')
  })

  it('does not throw when calling methods (non-TTY)', () => {
    const spinner = createPhaseSpinner('test')
    assert.doesNotThrow(() => spinner.update('new text'))
    assert.doesNotThrow(() => spinner.succeed('done'))
  })

  it('does not throw when calling fail (non-TTY)', () => {
    const spinner = createPhaseSpinner('test')
    assert.doesNotThrow(() => spinner.fail('error'))
  })
})

describe('createBatchProgress', () => {
  it('returns an object with succeed, fail, and update methods', () => {
    const progress = createBatchProgress('test', 10)
    assert.strictEqual(typeof progress.succeed, 'function')
    assert.strictEqual(typeof progress.fail, 'function')
    assert.strictEqual(typeof progress.update, 'function')
  })

  it('does not throw when updating and succeeding (non-TTY)', () => {
    const progress = createBatchProgress('test', 5)
    assert.doesNotThrow(() => progress.update('test... 1/5'))
    assert.doesNotThrow(() => progress.update('test... 2/5'))
    assert.doesNotThrow(() => progress.succeed())
  })

  it('does not throw when failing (non-TTY)', () => {
    const progress = createBatchProgress('test', 5)
    assert.doesNotThrow(() => progress.fail('error'))
  })
})
