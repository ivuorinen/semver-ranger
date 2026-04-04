import ora from 'ora'

interface Spinner {
  succeed: (text?: string) => void
  fail: (text?: string) => void
  update: (text: string) => void
}

const noop = (): void => {}

const NOOP_SPINNER: Spinner = { succeed: noop, fail: noop, update: noop }

/**
 * Creates a spinner for a single CLI phase (e.g. parsing, local resolution).
 * @param {string} label Display text shown while the spinner is active.
 * @returns {Spinner} Spinner controls; no-op stubs when stderr is not a TTY.
 */
export function createPhaseSpinner(label: string): Spinner {
  if (!process.stderr.isTTY) return NOOP_SPINNER

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
 * @returns {Spinner} Progress controls; no-op stubs when stderr is not a TTY.
 */
export function createBatchProgress(label: string, total: number): Spinner {
  if (!process.stderr.isTTY) return NOOP_SPINNER

  const spinner = ora({ text: `${label}... 0/${total}`, stream: process.stderr }).start()

  return {
    succeed: (text?: string) => spinner.succeed(text ?? `${label}... ${total}/${total}`),
    fail: (text?: string) => spinner.fail(text ?? label),
    update(text: string) {
      spinner.text = text
    }
  }
}
