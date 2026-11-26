/**
 * Shared pieces of this project's PreToolUse hooks: printing a decision and
 * splitting a Bash command line into words. Kept in one place so the hooks parse
 * commands identically.
 */

/**
 * Prints the hook decision and exits.
 * @param {'ask' | 'deny'} decision The permission decision.
 * @param {string} reason Shown to the user and the agent.
 * @returns {never} Never returns; the process exits.
 */
export function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })
  )
  process.exit(0)
}

/**
 * Splits a shell command into segments of words, honouring quotes and
 * backslashes. Operators split segments; expansions are not evaluated, so a
 * `$VAR` word stays literal.
 * @param {string} command The Bash command line.
 * @returns {string[][]} Words of each segment.
 */
export function segments(command) {
  const result = [[]]
  let word = ''
  let inWord = false
  let quote = ''
  const flush = () => {
    if (inWord) result.at(-1).push(word)
    word = ''
    inWord = false
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (quote !== '') {
      if (char === quote) quote = ''
      else if (char === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      inWord = true
    } else if (char === '\\' && i + 1 < command.length) {
      word += command[++i]
      inWord = true
    } else if (/[;&|\n()]/u.test(char)) {
      flush()
      if (result.at(-1).length > 0) result.push([])
    } else if (/\s/u.test(char)) {
      flush()
    } else {
      word += char
      inWord = true
    }
  }
  flush()
  return result.filter(words => words.length > 0)
}
