const core = require('@actions/core');
const { getVersion, isBeta } = require('./version-helper');
const { exec } = require('./common');

const version = process.env.VERSION || getVersion();
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
  GIT_DESCRIBE: ci ? exec('git describe --abbrev=7') : `v${version}`,
  ACTION_BUILD_URL: process.env.ACTION_BUILD_URL,
  DISCORD_WEBHOOK_RELEASE: process.env.DISCORD_WEBHOOK_RELEASE,
};

envs.SOURCE_ZIP = `${envs.RELEASE_PREFIX}-${envs.VERSION}-source.zip`;
envs.ASSET_ZIP = `${envs.RELEASE_PREFIX}-webext-v${envs.VERSION}.zip`;
envs.ASSET_CWS_BETA_ZIP = `${envs.RELEASE_PREFIX}-webext-beta-v${envs.VERSION}.zip`;
envs.ASSET_SELF_HOSTED_ZIP = `${envs.RELEASE_PREFIX}-webext-ffself-v${envs.VERSION}.zip`;

Object.entries(envs).forEach(([key, value]) => {
  core.exportVariable(key, value);
});
