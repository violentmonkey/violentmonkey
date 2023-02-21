const pkg = require('../package.json');

/**
 * Derive extension version from pkg.version and pkg.beta fields.
 *
 * > manifest.version = `${pkg.version}.${pkg.beta}`
 */
function getVersion() {
  return `${pkg.version.match(/\d+\.\d+/)[0]}.${pkg.beta || 0}${
  // Create a beta release with the same code as in stable release.
  // Used in unlisted version.
    process.env.BETA ? 'b' : ''
  }`;
}

function isBeta() {
  return process.env.BETA || pkg.beta > 0;
}

exports.getVersion = getVersion;
exports.isBeta = isBeta;
