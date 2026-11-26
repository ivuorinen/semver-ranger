import { styleText } from 'node:util'

interface Spinner {
  succeed: (text?: string) => void
  fail: (text?: string) => void
  update: (text: string) => void
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const FRAME_MS = 80
const CLEAR_LINE = '\r\u001B[K'

const noop = (): void => {}

const NOOP_SPINNER: Spinner = { succeed: noop, fail: noop, update: noop }

/**
 * Starts an animated stderr spinner. The cursor stays visible, so nothing has to
 * restore it if the process is interrupted.
 * @param {string} initialText Text shown until the first update().
 * @param {string} succeedText Text shown by succeed() when called without text.
 * @param {string} failText Text shown by fail() when called without text.
 * @returns {Spinner} Spinner controls; no-op stubs when stderr is not an interactive terminal.
 */
function startSpinner(initialText: string, succeedText: string, failText: string): Spinner {
  const stream = process.stderr
  if (!stream.isTTY || process.env.TERM === 'dumb') return NOOP_SPINNER

  let text = initialText
  let frame = 0
  const draw = (): void => {
    const symbol = styleText('cyan', FRAMES.charAt(frame % FRAMES.length), { stream })
    frame += 1
    // Clipped to one row: CLEAR_LINE cannot erase a line that has wrapped.
    stream.write(`${CLEAR_LINE}${symbol} ${text.slice(0, stream.columns - 2)}`)
  }
  const timer = setInterval(draw, FRAME_MS)
  timer.unref()
  draw()

  const finish = (color: 'green' | 'red', symbol: string, finalText: string): void => {
    clearInterval(timer)
    stream.write(`${CLEAR_LINE}${styleText(color, symbol, { stream })} ${finalText}\n`)
  }

  return {
    succeed: (finalText = succeedText) => finish('green', '✔', finalText),
    fail: (finalText = failText) => finish('red', '✖', finalText),
    update(nextText: string) {
      text = nextText
    }
  }
}

/**
 * Creates a spinner for a single CLI phase (e.g. parsing, local resolution).
 * @param {string} label Display text shown while the spinner is active.
 * @returns {Spinner} Spinner controls; no-op stubs when stderr is not a TTY.
 */
export function createPhaseSpinner(label: string): Spinner {
  return startSpinner(label, label, label)
}

/**
 * Creates a progress spinner for batch operations (e.g. registry lookups).
 * Updates are driven by the caller via update(); succeed() finalizes.
 * @param {string} label Display text prefix shown while the spinner is active.
 * @param {number} total Total number of items to process.
 * @returns {Spinner} Progress controls; no-op stubs when stderr is not a TTY.
 */
export function createBatchProgress(label: string, total: number): Spinner {
  return startSpinner(`${label}... 0/${total}`, `${label}... ${total}/${total}`, label)
}
