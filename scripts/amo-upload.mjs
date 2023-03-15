import { rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { signAddon } from 'amo-upload';
import { readManifest, buildUpdatesList } from './manifest-helper.js';
import { getVersion, isBeta } from './version-helper.js';
import { hasAsset } from './release-helper.js';

async function main() {
  const manifest = await readManifest();
  const rawVersion = process.env.VERSION;
  const version = getVersion();
  const beta = isBeta();
  const fileName = `violentmonkey-${version}${beta ? 'b' : ''}-an+fx.xpi`;
  const url = `https://github.com/violentmonkey/violentmonkey/releases/download/v${rawVersion}/${fileName}`;

  if (await hasAsset(fileName)) {
    // Throw an error so `updates.json` won't be updated in the next step.
    throw new Error('File already downloaded, skipping');
  }

  const pollOptions = !beta ? {
    // disable status checking for listed versions since
    // we don't need to download the signed version
    pollRetry: 0,
  } : {
    pollInterval: 30000,
    pollRetry: 30,
  };

  const tempFile = join(process.env.TEMP_DIR, Math.random().toString(36).slice(2, 8).toString());
  const releaseUrl = `https://github.com/violentmonkey/violentmonkey/releases/tag/v${version}`;
  await signAddon({
    apiKey: process.env.AMO_KEY,
    apiSecret: process.env.AMO_SECRET,
    addonId: manifest.browser_specific_settings.gecko.id,
    addonVersion: version,
    channel: beta ? 'unlisted' : 'listed',
    distFile: beta
      ? join(process.env.TEMP_DIR, process.env.ASSET_SELF_HOSTED_ZIP)
      : join(process.env.ASSETS_DIR, process.env.ASSET_ZIP),
    sourceFile: join(process.env.TEMP_DIR, process.env.SOURCE_ZIP),
    approvalNotes: `\
yarn && yarn build
`,
    releaseNotes: {
      'en-US': `\
Please follow the link below to view the change log:

${releaseUrl}
`,
    },
    output: tempFile,
    ...pollOptions,
  });

  const xpiFile = join(process.env.ASSETS_DIR, fileName);
  await rename(tempFile, xpiFile);

  const updates = await buildUpdatesList(version, url);
  await writeFile(join(process.env.TEMP_DIR, 'updates/updates.json'), JSON.stringify(updates, null, 2), 'utf8');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
