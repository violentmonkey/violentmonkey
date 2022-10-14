const { readdir, readFile } = require('fs/promises');
const { join } = require('path');
const github = require('@actions/github');

const { VERSION, ASSETS_DIR, GITHUB_TOKEN } = process.env;
const tag = `v${VERSION}`;

const octokit = github.getOctokit(GITHUB_TOKEN);

async function getRelease() {
  try {
    const result = await octokit.rest.repos.getReleaseByTag({
      ...github.context.repo,
      tag,
    });
    console.info('Found release:', tag);
    return result.data;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

async function createRelease() {
  console.info('Create release:', tag);
  const result = await octokit.rest.repos.createRelease({
    ...github.context.repo,
    tag_name: tag,
    name: process.env.RELEASE_NAME,
    body: process.env.RELEASE_NOTE,
    prerelease: process.env.PRERELEASE == 'true',
  });
  return result.data;
}

async function ensureRelease() {
  const release = await getRelease() || await createRelease();
  return release;
}

async function hasAsset(fileName) {
  const release = await getRelease();
  return release?.assets.some(asset => asset.name === fileName);
}

async function uploadAssets() {
  const release = await ensureRelease();
  let assets = await readdir(ASSETS_DIR);
  assets = assets.filter(asset => release.assets.every(({ name }) => name !== asset));
  for (const asset of assets) {
    console.info(`> Upload asset: ${asset}`);
    await octokit.rest.repos.uploadReleaseAsset({
      ...github.context.repo,
      release_id: release.id,
      name: asset,
      data: await readFile(join(ASSETS_DIR, asset)),
    });
  }
  if (assets.length) console.info('Done');
  else console.info('No asset to upload');
}

exports.getRelease = getRelease;
exports.createRelease = createRelease;
exports.ensureRelease = ensureRelease;
exports.uploadAssets = uploadAssets;
exports.hasAsset = hasAsset;
