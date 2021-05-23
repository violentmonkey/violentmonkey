const fs = require('fs').promises;
const path = require('path');
const { signAddon } = require('sign-addon');
const { readManifest, buildUpdatesList } = require('./manifest-helper');
const { getVersion } = require('./version-helper');

async function main() {
  const manifest = await readManifest();
  const rawVersion = process.env.VERSION;
  // version may be suffixed for unlisted version
  const version = getVersion();
  const result = await signAddon({
    xpiPath: path.join(process.env.TEMP_DIR, process.env.ASSET_SELF_HOSTED_ZIP),
    version,
    apiKey: process.env.AMO_KEY,
    apiSecret: process.env.AMO_SECRET,
    channel: 'unlisted',
    downloadDir: process.env.ASSETS_DIR,
    id: manifest.browser_specific_settings.gecko.id,
  });
  if (!result.success) {
    console.error(result);
    if (!result.errorDetails?.startsWith('Version already exists.')) {
      process.exitCode = 1;
      return;
    }
  }
  // const fileName = path.basename(result.downloadedFiles[0]);
  const fileName = `violentmonkey-${version}-an+fx.xpi`;
  const url = `https://github.com/violentmonkey/violentmonkey/releases/download/v${rawVersion}/${fileName}`;
  const updates = await buildUpdatesList(version, url);
  await fs.writeFile(path.join(process.env.TEMP_DIR, 'updates/updates.json'), JSON.stringify(updates, null, 2), 'utf8');
}

main();
