import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import { createPhaseSpinner, createBatchProgress } from '../../src/output/progress.ts'

let originalIsTTY: boolean | undefined

beforeEach(() => {
  originalIsTTY = process.stderr.isTTY
  process.stderr.isTTY = false as never
})

afterEach(() => {
  process.stderr.isTTY = originalIsTTY as never
})

describe('spinner on a terminal', () => {
  const originalColumns = process.stderr.columns
  const originalTerm = process.env.TERM
  const originalForceColor = process.env.FORCE_COLOR
  let writes: string[] = []

  beforeEach(() => {
    process.stderr.isTTY = true as never
    process.stderr.columns = 80
    delete process.env.TERM
    delete process.env.FORCE_COLOR
    writes = []
    mock.method(process.stderr, 'write', (chunk: string) => {
      writes.push(chunk)
      return true
    })
    mock.timers.enable({ apis: ['setInterval'] })
  })

  afterEach(() => {
    mock.timers.reset()
    mock.restoreAll()
    process.stderr.columns = originalColumns
    if (typeof originalTerm === 'undefined') delete process.env.TERM
    else process.env.TERM = originalTerm
    if (typeof originalForceColor !== 'undefined') process.env.FORCE_COLOR = originalForceColor
  })

  // Colour follows stderr, which is the terminal here while stdout is a pipe.
  it('clears the line, steps through the frames and marks success in green', () => {
    const spinner = createPhaseSpinner('working')
    mock.timers.tick(80)
    spinner.succeed('done')
    assert.deepStrictEqual(writes, [
      '\r\u001B[K\u001B[36m⠋\u001B[39m working',
      '\r\u001B[K\u001B[36m⠙\u001B[39m working',
      '\r\u001B[K\u001B[32m✔\u001B[39m done\n'
    ])
  })

  it('marks a failure in red', () => {
    createPhaseSpinner('parsing').fail()
    assert.strictEqual(writes.at(-1), '\r\u001B[K\u001B[31m✖\u001B[39m parsing\n')
  })

  it('draws immediately, redraws updates, and stops drawing once finished', () => {
    const spinner = createPhaseSpinner('starting')
    assert.ok(writes.at(-1)?.endsWith('starting'))

    spinner.update('working')
    mock.timers.tick(80)
    assert.ok(writes.at(-1)?.endsWith('working'))

    spinner.succeed('done')
    assert.ok(writes.at(-1)?.endsWith('done\n'))
    const finished = writes.length
    mock.timers.tick(800)
    assert.strictEqual(writes.length, finished, 'timer kept drawing after succeed')
  })

  it('stops drawing after fail and defaults to the label', () => {
    const spinner = createPhaseSpinner('parsing')
    spinner.fail()
    assert.ok(writes.at(-1)?.endsWith('parsing\n'))
    const finished = writes.length
    mock.timers.tick(800)
    assert.strictEqual(writes.length, finished, 'timer kept drawing after fail')
  })

  it('counts a batch from zero and finishes at the total', () => {
    const progress = createBatchProgress('Fetching', 5)
    assert.ok(writes.at(-1)?.endsWith('Fetching... 0/5'))
    progress.succeed()
    assert.ok(writes.at(-1)?.endsWith('Fetching... 5/5\n'))
  })

  // A wrapped line cannot be cleared, so each frame would leave a row behind.
  it('clips the animated line to the terminal width', () => {
    process.stderr.columns = 10
    const spinner = createPhaseSpinner('much longer than ten columns')
    assert.ok(writes.at(-1)?.endsWith('much lon'))
    spinner.succeed()
  })

  it('stays silent on a dumb terminal', () => {
    process.env.TERM = 'dumb'
    createPhaseSpinner('hidden').succeed()
    assert.deepStrictEqual(writes, [])
  })
})

describe('spinner nobody finished', () => {
  // An error path that skips succeed() and fail() must not hang the command.
  it('does not keep the process alive', () => {
    const module = JSON.stringify(new URL('../../src/output/progress.ts', import.meta.url).href)
    const script = `process.stderr.isTTY = true
      const { createPhaseSpinner } = await import(${module})
      createPhaseSpinner('left running')`
    const { status, signal } = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TERM: 'xterm' },
      timeout: 10_000
    })
    assert.strictEqual(status, 0, `exit ${String(status)}, signal ${String(signal)}`)
  })
})

describe('spinner without a terminal', () => {
  it('writes nothing to stderr, whatever it is asked to do', () => {
    const write = mock.method(process.stderr, 'write', () => true)
    try {
      for (const spinner of [createPhaseSpinner('test'), createBatchProgress('test', 5)]) {
        spinner.update('new text')
        spinner.succeed('done')
        spinner.fail('error')
      }
      assert.strictEqual(write.mock.callCount(), 0)
    } finally {
      mock.restoreAll()
    }
  })
})
