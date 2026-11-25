const pkg = require('../package.json');
const { exec } = require('./common');

/**
 * Derive extension version from pkg.version and pkg.beta fields.
 *
 * > manifest.version = `${pkg.version}.${pkg.beta}`
 */
function getVersion() {
  return (
    process.env.VERSION ||
    `${pkg.version.match(/\d+\.\d+/)[0]}.${pkg.beta || 0}`
  );
}

function gitDescribe() {
  return exec('git', ['describe', '--abbrev=7']) || '';
}

function isBeta() {
  return process.env.BETA || pkg.beta > 0;
}

exports.getVersion = getVersion;
exports.gitDescribe = gitDescribe;
exports.isBeta = isBeta;
