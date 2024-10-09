/**
 * Load the package-lock.json file and return the parsed object.
 *
 * @param {string} file - path to package-lock.json file
 * @returns {object} - parsed package-lock.json object
 */
function loadPackageLock(file) {
  const fs = require('fs')
  const path = require('path')
  const file_path = path.resolve(file)
  if (!fs.existsSync(file_path)) {
    throw new Error(`File ${file} does not exist`)
  }
  const data = fs.readFileSync(file_path)
  return JSON.parse(data)
}

/**
 * Takes the package-lock.json and turns it into
 * a package-lock-parser object.
 *
 * @param {string} packageLockJson
 * @returns {DependencyTree}
 */
function parsePackageLock(packageLockJson) {
  const plp = require('package-lock-parser')

  return plp.parse(packageLockJson)
}

/**
 * Search for package name in other packages dependencies,
 * devDependencies, and peerDependencies, engines and
 * return the version ranges.
 *
 * @param {object} package_lock - package-lock.json object
 * @param {string} package_name - name of the package to search for
 * @returns {object} - object containing the package name and version range
 */
function getPackageVersionRange(package_lock, package_name) {
  const dependencies = package_lock.dependencies
  const devDependencies = package_lock.devDependencies

  const ranges = []

  ranges[package_name] = {
    dependencies: [],
    devDependencies: [],
    peerDependencies: [],
    engines: {}
  }

  for (const depKey in dependencies) {
    const dep = dependencies[depKey]
    if (dep.dependencies && dep.dependencies[package_name]) {
      ranges[depKey].dependencies.push(dep.dependencies[package_name])
    }
  }
  for (const devKey in devDependencies) {
    const dep = devDependencies[devKey]
    if (dep.devDepencencies && dep.devDependencies[package_name]) {
      ranges[devKey].devDependencies.push(dep.devDependencies[package_name])
    }
  }

  const pkg = dependencies[package_name] || devDependencies[package_name]
  return {
    name: package_name,
    version: pkg.version,
    ranges: ranges
  }
}

export { loadPackageLock, getPackageVersionRange, parsePackageLock }
