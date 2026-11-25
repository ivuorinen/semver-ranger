/**
 * Fails when the npm tarball holds anything besides the built CLI and the files
 * npm always adds.
 *
 * `files` in package.json is the allowlist. This catches it being widened, and
 * a tarball packed without dist/, which would install a `semver-ranger` bin that
 * does not exist.
 */
import { execFileSync } from 'node:child_process'

const ALWAYS = new Set(['LICENSE', 'README.md', 'package.json'])

const [tarball] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' })
)
const paths = tarball.files.map(file => file.path)
const extra = paths.filter(path => !ALWAYS.has(path) && !path.startsWith('dist/'))

if (extra.length > 0) {
  process.stderr.write(
    `The npm tarball would ship files outside dist/:\n${extra.map(path => `  ${path}\n`).join('')}`
  )
  process.exitCode = 1
} else if (!paths.includes('dist/cli.js')) {
  process.stderr.write('The npm tarball has no dist/cli.js: run npm run build first.\n')
  process.exitCode = 1
} else {
  process.stdout.write(`The npm tarball holds only the allowed ${paths.length} files.\n`)
}
