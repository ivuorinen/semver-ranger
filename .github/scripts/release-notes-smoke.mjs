/**
 * Smoke-tests the semantic-release commit analysis and release-notes chain
 * without tokens, so a PR that breaks it fails CI instead of the next Publish.
 *
 * Publish run 34754580307 died in generateNotes: preset template 1.4.0 needs
 * conventional-changelog-writer@9 while release-notes-generator 14 pulled in 8.
 * `semantic-release --dry-run` cannot catch that on a PR, because its
 * verifyConditions step needs the npm OIDC exchange.
 *
 * Plugins resolve from the project's node_modules, which is where
 * semantic-release loads them from in Publish. Covers analyzeCommits and
 * generateNotes only; the npm and github plugins need credentials.
 */
import assert from 'node:assert/strict'
import config from '@ivuorinen/semantic-release-config'
import { analyzeCommits } from '@semantic-release/commit-analyzer'
import { generateNotes } from '@semantic-release/release-notes-generator'

const pluginOptions = name => config.plugins.find(p => Array.isArray(p) && p[0] === name)[1]

const context = {
  cwd: process.cwd(),
  options: { repositoryUrl: 'https://github.com/ivuorinen/semver-ranger.git' },
  commits: [
    { hash: 'a'.repeat(40), message: 'fix(parser): smoke fix', commit: { short: 'aaaaaaa' } },
    { hash: 'b'.repeat(40), message: 'chore(deps): smoke bump', commit: { short: 'bbbbbbb' } }
  ],
  lastRelease: { gitTag: 'v0.0.0', version: '0.0.0' },
  nextRelease: { gitTag: 'v0.0.1', version: '0.0.1' },
  logger: { log() {}, error() {} },
  env: {}
}

const type = await analyzeCommits(pluginOptions('@semantic-release/commit-analyzer'), context)
assert.strictEqual(type, 'patch')

const notes = await generateNotes(
  pluginOptions('@semantic-release/release-notes-generator'),
  context
)
assert.match(notes, /### Bug Fixes/u)
assert.match(notes, /### Maintenance/u)
