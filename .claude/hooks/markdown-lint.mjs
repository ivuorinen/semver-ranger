#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Edit|Write): lints a Markdown file right after it is
 * written and feeds markdownlint and Prettier failures back to the agent.
 *
 * Markdown that fails `npm run lint` kept surfacing only at the end-of-task gate
 * or in CI (dd10dcc, 56355b8, 81e8970, and three finding files in one audit run).
 * PostToolUse cannot block, and does not need to: the write has happened and the
 * point is to fix it at once. The hook's own failure is reported the same way,
 * never swallowed. It runs the repository's own binaries with the same configs
 * as `npm run lint`, so the feedback matches the gate.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const MAX_LINES = 20

/**
 * Hands text back to the agent as context for its next step, then exits.
 * @param {string} text What the agent should see.
 * @returns {never} Never returns; the process exits.
 */
function feedback(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text }
    })
  )
  process.exit(0)
}

/**
 * Runs both Markdown checks on one file.
 * @param {string} root Project root, where node_modules/.bin and the configs live.
 * @param {string} file The file, relative to root.
 * @returns {string[]} Output lines of every failing check; empty when both pass.
 */
function lint(root, file) {
  const checks = [
    [
      'markdownlint',
      ['--config', '.markdownlint.json', '--ignore-path', '.markdownlintignore', file]
    ],
    ['prettier', ['--check', file]]
  ]
  return checks.flatMap(([tool, args]) => {
    try {
      execFileSync(join(root, 'node_modules', '.bin', tool), args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return []
    } catch (err) {
      // A lint failure exits non-zero with its report on stdout or stderr.
      const output = `${err?.stdout ?? ''}${err?.stderr ?? ''}`.trim()
      return output === ''
        ? [`${tool}: ${err instanceof Error ? err.message : String(err)}`]
        : output.split('\n')
    }
  })
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd())
  const target = String(input.tool_input?.file_path ?? '')
  const file = relative(root, resolve(root, target))
  const outside = file.startsWith('..') || isAbsolute(file)
  if (!target.endsWith('.md') || outside || file.split(/[\\/]/u).includes('node_modules')) {
    process.exit(0)
  }
  const problems = lint(root, file)
  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_LINES).join('\n')
    feedback(`markdown-lint: ${file} would fail npm run lint; fix it now:\n${shown}`)
  }
} catch (err) {
  feedback(`markdown-lint failed: ${err instanceof Error ? err.message : String(err)}`)
}
