/**
 * semver-ranger is CLI Command to parse project's package-lock.json file and
 * returns list of all packages current versions and version ranges
 * the package expects. User can also specify a package (or node itself)
 * to see what versions all dependencies are expecting.
 */

const argv = process.argv
const args = argv.slice(2)
const ui = require('cliui')({ width: 70 })

if (argv.includes('--version')) {
  console.log('Version: 1.0.0')
  process.exit(0)
}

function help () {
  ui.div(
    'Usage: npx semver-ranger\n' +
      '  [package-lock.json]\t  if provided, uses provided package-lock.json file\n' +
      '  [package-name]\t  if provided, return semver range for that package\n' +
      '  --version\t  print out the version\n' +
      '  --help\t  print out this help'
  )

  console.log(ui.toString())
}

if (argv.includes('--help')) {
  help()
  process.exit(0)
}

// Check if first argument in args is a package-lock.json file, if it's not,
// check if the directory the script was run contains package-lock.json file.
if (args.length > 2) {
  console.error(
    'Too many arguments, first one should be either' +
      ' package name, or package-lock.json location.'
  )
  help()
  process.exit(1)
}

// vim: ts=2 sw=2
