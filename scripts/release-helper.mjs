import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import github from '@actions/github';

const { VERSION, ASSETS_DIR, GITHUB_TOKEN } = process.env;
const tag = `v${VERSION}`;

let octokit;
function getOctokit() {
  octokit ||= github.getOctokit(GITHUB_TOKEN);
  return octokit;
}

export async function getRelease() {
  try {
    const result = await getOctokit().rest.repos.getReleaseByTag({
      ...github.context.repo,
      tag,
    });
    console.info('Found release:', tag);
    return result.data;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export async function createRelease() {
  console.info('Create release:', tag);
  const result = await getOctokit().rest.repos.createRelease({
    ...github.context.repo,
    tag_name: tag,
    name: process.env.RELEASE_NAME,
    body: process.env.RELEASE_NOTE,
    prerelease: process.env.PRERELEASE == 'true',
  });
  return result.data;
}

export async function ensureRelease() {
  const release = await getRelease() || await createRelease();
  return release;
}

export async function hasAsset(fileName) {
  const release = await getRelease();
  return release?.assets.some(asset => asset.name === fileName);
}

export async function uploadAssets() {
  const release = await ensureRelease();
  let assets = await readdir(ASSETS_DIR);
  assets = assets.filter(asset => release.assets.every(({ name }) => name !== asset));
  for (const asset of assets) {
    console.info(`> Upload asset: ${asset}`);
    await getOctokit().rest.repos.uploadReleaseAsset({
      ...github.context.repo,
      release_id: release.id,
      name: asset,
      data: await readFile(join(ASSETS_DIR, asset)),
    });
  }
  if (assets.length) console.info('Done');
  else console.info('No asset to upload');
}

export async function notifyReleaseStatus({ title, description, success = true }) {
  const { DISCORD_WEBHOOK_RELEASE } = process.env;
  if (!DISCORD_WEBHOOK_RELEASE) {
    console.warn('DISCORD_WEBHOOK_RELEASE is not available!');
    return;
  }
  const res = await fetch(DISCORD_WEBHOOK_RELEASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [
        {
          title,
          description,
          color: success ? 0x00ff00 : 0xff0000,
        },
      ],
    }),
  });
  if (!res.ok) console.error(res);
}
