#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash|Edit|Write): asks before a runtime dependency
 * is added, by `npm install <pkg>` (or any of npm's aliases for it) without
 * `-D`/`--save-dev`, by `npm pkg set dependencies.<pkg>=...`, or by an edit to a
 * package.json that adds a key under `dependencies` or `optionalDependencies`
 * (both install in production).
 *
 * The project keeps runtime dependencies to the few package.json lists, and
 * nothing enforced it. Global installs, `--no-save` and dev installs pass. Malformed
 * input or an internal error denies: a guard that allows on failure checks
 * nothing. Matching `npm` by basename and listing every alias closed the
 * `/usr/local/bin/npm install`, `npm inst` and `npm pkg set` bypasses.
 * ponytail: a shell write to package.json (`sed -i`, `node -e`) still passes;
 * the Edit/Write branch covers the agent's own editing tools.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decide, segments } from './hook-io.mjs'

// Every name `npm help install` accepts for the command.
const INSTALL = new Set([
  'add',
  'i',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'install',
  'isnt',
  'isnta',
  'isntal',
  'isntall'
])
const PASS_FLAGS = new Set(['-D', '--save-dev', '-g', '--global', '--no-save'])
const RUNTIME_BLOCKS = ['dependencies', 'optionalDependencies']
const RUNTIME_KEY = /^(?:dependencies|optionalDependencies)\.([^=]+)/u

/**
 * Returns the packages a Bash segment adds as runtime dependencies.
 * @param {string[]} words Words of one segment.
 * @returns {string[]} Package operands; empty when the segment adds none.
 */
function runtimeInstalls(words) {
  if (basename(words[0] ?? '') !== 'npm') return []
  if (words[1] === 'pkg' && words[2] === 'set') {
    return words.slice(3).flatMap(arg => RUNTIME_KEY.exec(arg)?.[1] ?? [])
  }
  if (!INSTALL.has(words[1])) return []
  const args = words.slice(2)
  if (args.some(arg => PASS_FLAGS.has(arg))) return []
  return args.filter(arg => !arg.startsWith('-'))
}

/**
 * Lists the runtime dependency names a JSON text declares, or null when it is
 * not a JSON object (an edit that breaks the file is caught elsewhere).
 * @param {string} text package.json content.
 * @returns {Set<string> | null} Declared runtime dependency names.
 */
function runtimeNames(text) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof manifest !== 'object' || manifest === null) return null
  return new Set(RUNTIME_BLOCKS.flatMap(block => Object.keys(manifest[block] ?? {})))
}

/**
 * Returns the file content an Edit or Write would leave, or null when the edit
 * would not apply (Edit then fails on its own).
 * @param {string} toolName Edit or Write.
 * @param {Record<string, unknown>} toolInput The tool's input.
 * @param {string} before Current content, or '' for a new file.
 * @returns {string | null} Content after the tool runs.
 */
function contentAfter(toolName, toolInput, before) {
  if (toolName === 'Write') return String(toolInput.content ?? '')
  const oldString = String(toolInput.old_string ?? '')
  const newString = String(toolInput.new_string ?? '')
  if (oldString === '' || !before.includes(oldString)) return null
  return toolInput.replace_all === true
    ? before.split(oldString).join(newString)
    : before.replace(oldString, () => newString)
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const toolInput = input.tool_input ?? {}

  if (input.tool_name === 'Bash') {
    if (typeof toolInput.command !== 'string') {
      decide('deny', 'runtime-deps-guard: tool_input.command is missing')
    }
    const added = segments(toolInput.command).flatMap(runtimeInstalls)
    if (added.length > 0) {
      decide(
        'ask',
        `Adds runtime dependencies: ${added.join(', ')}. This project keeps runtime ` +
          'dependencies to the few package.json lists; use a Node built-in, or -D for a dev tool.'
      )
    }
  } else if (input.tool_name === 'Edit' || input.tool_name === 'Write') {
    const file = String(toolInput.file_path ?? '')
    if (basename(file) === 'package.json' && !file.split(/[\\/]/u).includes('node_modules')) {
      let before = ''
      try {
        before = readFileSync(file, 'utf8')
      } catch (err) {
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err
      }
      const after = contentAfter(input.tool_name, toolInput, before)
      const oldNames = runtimeNames(before) ?? new Set()
      const newNames = after === null ? null : runtimeNames(after)
      const added = [...(newNames ?? [])].filter(name => !oldNames.has(name))
      if (added.length > 0) {
        decide(
          'ask',
          `Adds runtime dependencies to ${file}: ${added.join(', ')}. This project keeps ` +
            'runtime dependencies to the few package.json lists; use a Node built-in, ' +
            'or devDependencies.'
        )
      }
    }
  }
} catch (err) {
  decide('deny', `runtime-deps-guard failed: ${err instanceof Error ? err.message : String(err)}`)
}
