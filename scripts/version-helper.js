const pkg = require('../package.json');

/**
 * Derive extension version from pkg.version and pkg.beta fields.
 *
 * > manifest.version = `${pkg.version}.${pkg.beta}`
 */
function getVersion() {
  let version = pkg.version.replace(/-[^.]*/, '');
  if (pkg.beta) version += `.${pkg.beta}`;
  // Create a beta release with the same code as in stable release.
  // Used in unlisted version.
  else if (process.env.BETA) version += 'b';
  return version;
}

function isBeta() {
  return process.env.BETA || pkg.beta > 0;
}

exports.getVersion = getVersion;
exports.isBeta = isBeta;
