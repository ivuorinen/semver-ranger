import ora from 'ora'

interface PhaseSpinner {
  succeed: (text?: string) => void
  fail: (text?: string) => void
  update: (text: string) => void
}

interface BatchProgress {
  succeed: (text?: string) => void
  update: (text: string) => void
}

const noop = (): void => {}

const NOOP_PHASE: PhaseSpinner = { succeed: noop, fail: noop, update: noop }
const NOOP_BATCH: BatchProgress = { succeed: noop, update: noop }

/**
 * Creates a spinner for a single CLI phase (e.g. parsing, local resolution).
 * @param {string} label Display text shown while the spinner is active.
 * @returns {PhaseSpinner} Spinner controls; no-op stubs when stderr is not a TTY.
 */
export function createPhaseSpinner(label: string): PhaseSpinner {
  if (!process.stderr.isTTY) return NOOP_PHASE

  const spinner = ora({ text: label, stream: process.stderr }).start()
  return {
    succeed: (text?: string) => spinner.succeed(text ?? label),
    fail: (text?: string) => spinner.fail(text ?? label),
    update(text: string) {
      spinner.text = text
    }
  }
}

/**
 * Creates a progress spinner for batch operations (e.g. registry lookups).
 * Updates are driven by the caller via update(); succeed() finalizes.
 * @param {string} label Display text prefix shown while the spinner is active.
 * @param {number} total Total number of items to process.
 * @returns {BatchProgress} Progress controls; no-op stubs when stderr is not a TTY.
 */
export function createBatchProgress(label: string, total: number): BatchProgress {
  if (!process.stderr.isTTY) return NOOP_BATCH

  const spinner = ora({ text: `${label}... 0/${total}`, stream: process.stderr }).start()

  return {
    succeed: (text?: string) => spinner.succeed(text ?? `${label}... ${total}/${total}`),
    update(text: string) {
      spinner.text = text
    }
  }
}
