const { readFile, readdir } = require('node:fs/promises');
const { join } = require('node:path');
const { isNewerVersion, assetNames } = require('./fork-release');

const repo = { owner: 'Astrophage-IO', repo: 'violentmonkey' };
const url = `https://github.com/${repo.owner}/${repo.repo}`;

async function findRelease(request) {
  try {
    return (await request()).data;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

async function publishRelease({ repos, version, sha, assets }) {
  if (assets.length !== assetNames.length || assetNames.some(name => !assets.some(asset => asset.name === name))) {
    throw new Error('Incomplete release assets');
  }
  const tag = `astrophage-v${version}`;
  const existing = await findRelease(() => repos.getReleaseByTag({ ...repo, tag }));
  if (existing && !existing.draft) return existing;
  const latest = await findRelease(() => repos.getLatestRelease(repo));
  if (latest && !isNewerVersion(version, latest.tag_name.replace(/^astrophage-v/, ''))) {
    throw new Error(`Refusing to replace release ${latest.tag_name} with ${version}`);
  }
  const release = existing || (await repos.createRelease({
    ...repo,
    tag_name: tag,
    target_commitish: sha,
    name: `Violentmonkey (Astrophage) ${version}`,
    body: `Download **violentmonkey-orion.zip** for Orion on iPad or Mac. Installation and update details: [README](${url}/blob/${sha}/README.md#astrophage-builds-for-orion).

Packages include Astrophage-owned update feeds. Whether file-installed extensions update automatically depends on Orion; iPad automatic updates have not been verified. Export your userscripts before migrating from upstream Violentmonkey, then import them into this fork once.

${latest ? `[Changes since ${latest.tag_name}](${url}/compare/${latest.tag_name}...${tag}) · ` : ''}[Source commit](${url}/commit/${sha})`,
    draft: true,
    prerelease: false,
  })).data;
  for (const { name, data } of assets) {
    const previous = release.assets.find(asset => asset.name === name);
    if (previous) await repos.deleteReleaseAsset({ ...repo, asset_id: previous.id });
    const type = name.endsWith('.xml') ? 'application/xml'
      : name.endsWith('.json') ? 'application/json'
        : name.endsWith('.crx') ? 'application/x-chrome-extension'
          : name === 'SHA256SUMS' ? 'text/plain' : 'application/zip';
    await repos.uploadReleaseAsset({
      ...repo, release_id: release.id, name, data, headers: { 'content-type': type },
    });
  }
  return (await repos.updateRelease({
    ...repo, release_id: release.id, draft: false, prerelease: false, make_latest: 'true',
  })).data;
}

async function main() {
  const { getOctokit } = await import('@actions/github');
  const directory = 'dist-assets/fork';
  const assets = [];
  for (const name of (await readdir(directory)).sort()) {
    assets.push({ name, data: await readFile(join(directory, name)) });
  }
  const release = await publishRelease({
    repos: getOctokit(process.env.GITHUB_TOKEN).rest.repos,
    version: process.env.VERSION,
    sha: process.env.GITHUB_SHA,
    assets,
  });
  console.info(release.html_url);
}

if (require.main === module) main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});

module.exports = { publishRelease };
