const pkg = require('../package.json');

/**
 * Derive extension version from pkg.version and pkg.beta fields.
 *
 * > manifest.version = `${pkg.version}.${pkg.beta}`
 */
function getVersion() {
  let version = pkg.version.replace(/-[^.]*/, '');
  if (pkg.beta) version += `.${pkg.beta}`;
  return version;
}

function isBeta() {
  return pkg.beta > 0;
}

exports.getVersion = getVersion;
exports.isBeta = isBeta;
