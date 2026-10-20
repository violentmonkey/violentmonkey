const { createHash, createPrivateKey, createPublicKey } = require('node:crypto');
const { appendFileSync, readFileSync } = require('node:fs');
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable } = require('node:stream');
const { zipSync } = require('fflate');

const repository = 'Astrophage-IO/violentmonkey';
const releaseUrl = `https://github.com/${repository}/releases`;
const geckoId = 'violentmonkey@astrophage.io';
const assetNames = [
  'violentmonkey-orion.zip', 'violentmonkey-orion.xpi', 'violentmonkey-mv2.crx',
  'violentmonkey-mv3.zip', 'violentmonkey-mv3.crx',
  'updates.json', 'updates-crx.xml', 'updates-mv3.xml', 'SHA256SUMS',
];
const publicKey = createPublicKey(readFileSync(join(__dirname, 'fork-public-key.pem')))
.export({ type: 'spki', format: 'der' });

function getReleaseVersion(sequence) {
  const number = Number(sequence);
  if (!/^\d+$/.test(sequence) || !Number.isSafeInteger(number) || number < 1 || number > 4294967295) {
    throw new Error('Release sequence must be an integer between 1 and 4294967295');
  }
  return `3.0.${Math.floor(number / 65536)}.${number % 65536}`;
}

function parseVersion(version) {
  const parts = version.split('.').map(Number);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version) || parts.some(part => part > 65535)) {
    throw new Error(`Invalid browser version: ${version}`);
  }
  return parts;
}

function isNewerVersion(next, previous) {
  const a = parseVersion(next);
  const b = parseVersion(previous);
  const index = a.findIndex((value, i) => value !== b[i]);
  return index >= 0 && a[index] > b[index];
}

function getCrxId() {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

function configureManifest(manifest) {
  const mv3 = manifest.manifest_version === 3;
  manifest.name = 'Violentmonkey (Astrophage)';
  manifest[mv3 ? 'action' : 'browser_action'].default_title = manifest.name;
  manifest.key = publicKey.toString('base64');
  manifest.update_url = `${releaseUrl}/latest/download/${mv3 ? 'updates-mv3.xml' : 'updates-crx.xml'}`;
  if (!mv3) Object.assign(manifest.browser_specific_settings.gecko, {
    id: geckoId,
    update_url: `${releaseUrl}/latest/download/updates.json`,
  });
  return manifest;
}

function buildFeeds(manifest, xpiHash, mv3Manifest = { minimum_chrome_version: '135.0' }) {
  const { version } = manifest;
  parseVersion(version);
  const assetUrl = `${releaseUrl}/download/astrophage-v${version}`;
  const xml = (mv, minVersion) => `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${getCrxId()}">
    <updatecheck codebase="${assetUrl}/violentmonkey-mv${mv}.crx" version="${version}" prodversionmin="${minVersion}" />
  </app>
</gupdate>\n`;
  return {
    'updates.json': {
      addons: {
        [geckoId]: {
          updates: [{
            version,
            update_link: `${assetUrl}/violentmonkey-orion.xpi`,
            update_hash: `sha256:${xpiHash}`,
          }],
        },
      },
    },
    'updates-crx.xml': xml(2, manifest.minimum_chrome_version),
    'updates-mv3.xml': xml(3, mv3Manifest.minimum_chrome_version),
  };
}

async function readDirectory(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, await readDirectory(path, `${name}/`));
    else if (entry.isFile()) files[name] = await readFile(path);
    else throw new Error(`Unexpected build entry: ${name}`);
  }
  return files;
}

async function packageRelease({ root = process.cwd(), privateKey = process.env.ASTROPHAGE_CRX_PRIVATE_KEY } = {}) {
  if (!privateKey) throw new Error('ASTROPHAGE_CRX_PRIVATE_KEY must be provided');
  const signingKey = createPrivateKey(privateKey);
  const actualKey = createPublicKey(signingKey).export({ type: 'spki', format: 'der' });
  if (!actualKey.equals(publicKey)) throw new Error('Signing key does not match fork-public-key.pem');
  const crx3 = require('crx3');
  const manifests = [];
  for (const dir of ['dist', 'dist-mv3']) {
    const manifest = JSON.parse(await readFile(join(root, dir, 'manifest.json'), 'utf8'));
    parseVersion(manifest.version);
    const expected = configureManifest(JSON.parse(JSON.stringify(manifest)));
    if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error(`Not a fork build: ${dir}`);
    manifests.push(manifest);
  }
  const version = manifests[0].version;
  if (manifests[1].version !== version || (process.env.VERSION && process.env.VERSION !== version)) {
    throw new Error('Build versions do not match');
  }
  const assets = join(root, 'dist-assets/fork');
  await mkdir(assets, { recursive: true });
  const keyDir = await mkdtemp(join(tmpdir(), 'astrophage-sign-'));
  const keyPath = join(keyDir, 'key.pem');
  const names = [];
  try {
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    for (const [i, dir] of ['dist', 'dist-mv3'].entries()) {
      const zip = zipSync(await readDirectory(join(root, dir)), { level: 9 });
      const zipName = i ? 'violentmonkey-mv3.zip' : 'violentmonkey-orion.zip';
      const crxName = `violentmonkey-mv${i + 2}.crx`;
      await writeFile(join(assets, zipName), zip);
      const { appId } = await crx3(Readable.from([zip]), { keyPath, crxPath: join(assets, crxName) });
      if (appId !== getCrxId()) throw new Error('Signed CRX identity does not match the update feed');
      names.push(zipName, crxName);
    }
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }
  const xpi = await readFile(join(assets, 'violentmonkey-orion.zip'));
  await writeFile(join(assets, 'violentmonkey-orion.xpi'), xpi);
  names.push('violentmonkey-orion.xpi');
  const feeds = buildFeeds(manifests[0], createHash('sha256').update(xpi).digest('hex'), manifests[1]);
  for (const [name, data] of Object.entries(feeds)) {
    await writeFile(join(assets, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
    names.push(name);
  }
  const sums = [];
  for (const name of names.sort()) {
    sums.push(`${createHash('sha256').update(await readFile(join(assets, name))).digest('hex')}  ${name}`);
  }
  await writeFile(join(assets, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  console.info(`Packaged Astrophage ${version} (${getCrxId()}) in ${assets}`);
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'prepare') {
    const version = getReleaseVersion(process.env.GITHUB_RUN_NUMBER);
    appendFileSync(process.env.GITHUB_ENV, `VERSION=${version}\nTARGET=astrophage\n`);
    console.info(`Astrophage ${version}`);
  } else if (command === 'package') {
    packageRelease().catch(err => {
      console.error(err.message);
      process.exitCode = 1;
    });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

module.exports = {
  configureManifest, getReleaseVersion, buildFeeds, getCrxId, isNewerVersion, packageRelease, assetNames,
};
