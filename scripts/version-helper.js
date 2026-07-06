const pkg = require('../package.json');
const { MV3 } = require('./common');

/**
 * Derive extension version from pkg.version and pkg.beta fields.
 *
 * > manifest.version = `${pkg.version}.${pkg.beta}`
 */
function getVersion() {
  const base = process.env.VERSION ||
    `${pkg.version.match(/\d+\.\d+/)[0]}.${pkg.beta || 0}`;
  return MV3 ? `${base}.3` : base;
}

function isBeta() {
  return process.env.BETA || pkg.beta > 0;
}

exports.getVersion = getVersion;
exports.isBeta = isBeta;
