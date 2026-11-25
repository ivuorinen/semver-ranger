#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash): asks before a command removes or moves a
 * tracked path whose basename other tracked files still name: `rm`, `unlink`,
 * `mv`, their `git` forms (including `git -C`), `xargs rm`, and `find -delete`
 * or `-exec rm`.
 *
 * Deleted files have left stale references behind more than once (.npmignore
 * listing the removed .tool-versions and .markdownlint-cli2.jsonc, .envrc
 * reading .tool-versions), each found only by a later audit. Untracked paths,
 * paths outside the project and globs pass, so build output and scratch files
 * never prompt. An operand containing `..`, malformed input or an internal
 * error denies: a hook that silently allows on failure checks nothing.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { decide, segments } from './hook-io.mjs'

const EXCLUDED = [':!package-lock.json', ':!docs/audit/findings/**', ':!docs/superpowers/**']
const MAX_LISTED = 10
// git's global options that take a value; they come before the subcommand.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const DELETERS = new Set(['rm', 'unlink'])
// A deletion whose targets only exist at run time (stdin, a find walk).
const UNRESOLVED = Symbol('unresolved')

/**
 * Returns the operands a segment removes from their current path, null when the
 * segment deletes or moves nothing, or UNRESOLVED when it deletes paths that
 * cannot be known before it runs. For `mv` the last operand is the destination,
 * which is not removed.
 *
 * Commands are matched by basename and after git's global options: matching
 * only a literal `rm`/`mv` first word let `/bin/rm`, `git -C . rm`, `unlink`,
 * `xargs rm` and `find -delete` remove referenced files without a prompt.
 * @param {string[]} words Words of one segment.
 * @returns {string[] | null | typeof UNRESOLVED} Removed operands.
 */
function removedOperands(words) {
  const command = basename(words[0] ?? '')
  const rest = words.slice(1)
  if (command === 'xargs') {
    return rest.some(arg => DELETERS.has(basename(arg)) || basename(arg) === 'mv')
      ? UNRESOLVED
      : null
  }
  if (command === 'find') {
    return rest.includes('-delete') || rest.some(arg => DELETERS.has(basename(arg)))
      ? UNRESOLVED
      : null
  }
  let args = words
  if (command === 'git') {
    args = rest
    while (args[0]?.startsWith('-')) args = args.slice(GIT_VALUE_OPTIONS.has(args[0]) ? 2 : 1)
  }
  const tool = basename(args[0] ?? '')
  if (tool === 'unlink') return args.slice(1)
  if (!['rm', 'mv'].includes(tool)) return null
  const operands = args.slice(1).filter(arg => !arg.startsWith('-'))
  return tool === 'mv' ? operands.slice(0, -1) : operands
}

/**
 * Runs git in the project and returns its stdout, or '' when git exits 1
 * (`git grep` exits 1 when nothing matches).
 * @param {string} root Project root.
 * @param {string[]} args Arguments to git.
 * @returns {string} Standard output.
 * @throws {Error} If git fails any other way, which the caller turns into a deny.
 */
function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'status' in err && err.status === 1) return ''
    throw err
  }
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (input.tool_name !== 'Bash') process.exit(0)
  const command = input.tool_input?.command
  if (typeof command !== 'string')
    decide('deny', 'deleted-path-refs: tool_input.command is missing')
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd())
  let cwd = resolve(input.cwd ?? root)

  const hits = new Map()
  const unresolved = []
  for (const words of segments(command)) {
    if (words[0] === 'cd' && words.length === 2) {
      cwd = resolve(cwd, words[1])
      continue
    }
    const removed = removedOperands(words)
    if (removed === UNRESOLVED) {
      unresolved.push(words.join(' '))
      continue
    }
    for (const operand of removed ?? []) {
      if (operand.split(/[\\/]/u).includes('..')) {
        decide(
          'deny',
          `deleted-path-refs: operand "${operand}" contains "..", use a path inside the project`
        )
      }
      if (/[*?[\]{}$`~]/u.test(operand)) continue
      const path = relative(root, resolve(cwd, operand))
      if (path === '' || path.startsWith('..') || isAbsolute(path)) continue
      if (git(root, ['ls-files', '--', path]).trim() === '') continue
      const name = basename(path)
      const files = git(root, ['grep', '-l', '-F', '-e', name, '--', '.', ...EXCLUDED])
        .split('\n')
        .filter(file => file !== '' && file !== path && !file.startsWith(`${path}/`))
      if (files.length > 0) hits.set(path, files)
    }
  }

  if (hits.size > 0 || unresolved.length > 0) {
    const lines = [...hits].map(([path, files]) => {
      const shown = files.slice(0, MAX_LISTED).join(', ')
      const more = files.length > MAX_LISTED ? ` and ${files.length - MAX_LISTED} more` : ''
      return `${path} is named in: ${shown}${more}`
    })
    for (const segment of unresolved) {
      lines.push(`\`${segment}\` deletes paths known only when it runs; check references by hand`)
    }
    decide(
      'ask',
      `Removing a referenced path. Update or confirm these references:\n${lines.join('\n')}`
    )
  }
} catch (err) {
  decide('deny', `deleted-path-refs failed: ${err instanceof Error ? err.message : String(err)}`)
}
