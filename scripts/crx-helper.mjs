import { mkdir, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { join } from 'path';
import { tmpdir } from 'os';
import { readManifest } from './manifest-helper.js';
import { getVersion } from './version-helper.js';

const require = createRequire(import.meta.url);
const crx3 = require('crx3');

const {
  ASSET_CRX,
  ASSETS_DIR = 'dist-assets',
  DIST = 'dist',
  GITHUB_REPOSITORY = 'violentmonkey/violentmonkey',
  TEMP_DIR = 'tmp',
} = process.env;

const version = getVersion();

async function getKeyPath() {
  if (!process.env.CRX_PRIVATE_KEY) {
    throw new Error('CRX_PRIVATE_KEY must be provided');
  }
  const keyPath = join(tmpdir(), 'violentmonkey-crx-key.pem');
  await writeFile(keyPath, process.env.CRX_PRIVATE_KEY);
  return keyPath;
}

async function main() {
  const keyPath = await getKeyPath();
  const crxName = ASSET_CRX || `violentmonkey-mv2-v${version}.crx`;
  const crxPath = join(ASSETS_DIR, crxName);
  await mkdir(ASSETS_DIR, { recursive: true });

  const { appId } = await crx3([join(DIST, 'manifest.json')], {
    keyPath,
    crxPath,
  });

  const manifest = readManifest();
  const url = `https://github.com/${GITHUB_REPOSITORY}/releases/download/v${version}/${crxName}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${appId}">
    <updatecheck codebase="${url}" version="${version}" prodversionmin="${manifest.minimum_chrome_version || '86.0'}" />
  </app>
</gupdate>`;
  const xmlDir = join(TEMP_DIR, 'updates');
  await mkdir(xmlDir, { recursive: true });
  await writeFile(join(xmlDir, 'updates-crx.xml'), xml);

  console.info(`> Sign CRX: ${crxPath} (appid: ${appId})`);
  console.info(`> Write update manifest: ${join(xmlDir, 'updates-crx.xml')}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
