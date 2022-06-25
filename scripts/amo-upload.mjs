import { createWriteStream } from 'fs';
import { rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { signAddon } from 'amo-upload';
import fetch from 'node-fetch';
import { readManifest, buildUpdatesList } from './manifest-helper.js';
import { getVersion, isBeta } from './version-helper.js';
import { hasAsset } from './release-helper.js';

async function main() {
  const manifest = await readManifest();
  const rawVersion = process.env.VERSION;
  // version may be suffixed for unlisted version
  const version = getVersion();
  const beta = isBeta();
  const fileName = `violentmonkey-${version}-an+fx.xpi`;
  const url = `https://github.com/violentmonkey/violentmonkey/releases/download/v${rawVersion}/${fileName}`;

  if (await hasAsset(fileName)) {
    console.info('File already downloaded, skipping');
    return;
  }

  const pollOptions = !beta && {
    // disable status checking for listed versions since
    // we don't need to download the signed version
    pollRetry: 0,
  };

  const file = await signAddon({
    apiKey: process.env.AMO_KEY,
    apiSecret: process.env.AMO_SECRET,
    addonId: manifest.browser_specific_settings.gecko.id,
    addonVersion: version,
    channel: beta ? 'unlisted' : 'listed',
    distFile: beta
      ? join(process.env.TEMP_DIR, process.env.ASSET_SELF_HOSTED_ZIP)
      : join(process.env.ASSETS_DIR, process.env.ASSETS_ZIP),
    sourceFile: join(process.env.TEMP_DIR, process.env.SOURCE_ZIP),
    ...pollOptions,
  });

  const xpiFile = join(process.env.ASSETS_DIR, fileName);
  await downloadFile(file.download_url, xpiFile);

  const updates = await buildUpdatesList(version, url);
  await writeFile(join(process.env.TEMP_DIR, 'updates/updates.json'), JSON.stringify(updates, null, 2), 'utf8');
}

async function downloadFile(url, file) {
  const res = await fetch(url);
  const tempFile = join(process.env.TEMP_DIR, Math.random().toString(36).slice(2, 8).toString());
  const stream = createWriteStream(tempFile);
  await new Promise((resolve, reject) => {
    res.body.pipe(stream);
    res.body.on('error', reject);
    stream.on('finish', resolve);
  });
  await rename(tempFile, file);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
