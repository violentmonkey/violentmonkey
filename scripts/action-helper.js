const childProcess = require('child_process');
const core = require('@actions/core');
const { getVersion, isBeta } = require('./version-helper');

const version = getVersion();
const beta = isBeta();
const ci = process.argv.includes('ci');

const envs = {
  VERSION: version,
  RELEASE_NAME: [
    beta && 'BETA',
    `v${version}`,
  ].filter(Boolean).join(' '),
  RELEASE_PREFIX: [
    'Violentmonkey',
    beta && 'beta',
  ].filter(Boolean).join('-'),
  PRERELEASE: !!beta,
  TEMP_DIR: 'tmp',
  ASSETS_DIR: 'dist-assets',
  GIT_DESCRIBE: ci && exec('git describe --abbrev=7')
    || `v${version}-${exec('git rev-parse HEAD').slice(0, 7)}`,
};

envs.ASSET_ZIP = `${envs.RELEASE_PREFIX}-webext-v${envs.VERSION}.zip`;
envs.ASSET_SELF_HOSTED_ZIP = `${envs.RELEASE_PREFIX}-webext-ffself-v${envs.VERSION}.zip`;

envs.RELEASE_NOTE = beta && !ci ? `\
**This is a beta release of Violentmonkey (also in [WebStore](\
https://chrome.google.com/webstore/detail/violentmonkey-beta/opokoaglpekkimldnlggpoagmjegichg\
)), use it at your own risk.**<br>\
If you already use Violentmonkey, click \`Export to zip\` in settings before installing the beta.

Notable changes:

${listCommits()}
` : `\
See <https://violentmonkey.github.io/> for more details.
`;

Object.entries(envs).forEach(([key, value]) => {
  core.exportVariable(key, value);
});

function listCommits() {
  const thisTag = exec('git describe --abbrev=0 --tags');
  const prevTag = exec(`git describe --abbrev=0 --tags "${thisTag}^"`);
  return exec(`git log --oneline --skip=1 --reverse "${prevTag}...${thisTag}"`)
  .replace(/</g, '\\<')
  .split('\n')
  .map((str, i) => `${str.split(/\s/, 2)[1]}${10000 + i}\n* ${str}`)
  .sort()
  .map(str => str.split('\n')[1])
  .join('\n');
}

function exec(cmd) {
  try {
    return childProcess.execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    // ignore
  }
}
