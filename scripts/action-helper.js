const core = require('@actions/core');
const { getVersion, isBeta } = require('./version-helper');

const version = getVersion();
const beta = isBeta();

core.exportVariable('VERSION', version);
core.exportVariable('RELEASE_NAME', [
  beta && 'BETA',
  `v${version}`,
].filter(Boolean).join(' '));
core.exportVariable('RELEASE_FILENAME', [
  'Violentmonkey',
  beta && 'beta',
  `v${version}`,
].filter(Boolean).join('-'));
core.exportVariable('PRERELEASE', !!beta);

// TODO generate release notes by conventional commit messages and add installation instructions
core.exportVariable('RELEASE_NOTE', beta ? `\
**This is a beta release of Violentmonkey, use it at your own risk.**
` : `\
See <https://violentmonkey.github.io/> for more details.
`);
