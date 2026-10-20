const { createHash, createPublicKey, generateKeyPairSync } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  configureManifest, getReleaseVersion, buildFeeds, getCrxId, isNewerVersion, packageRelease,
} = require('../../scripts/fork-release');

const baseUrl = 'https://github.com/Astrophage-IO/violentmonkey/releases';
const key = createPublicKey(readFileSync(resolve(__dirname, '../../scripts/fork-public-key.pem')))
.export({ type: 'spki', format: 'der' });

test.each([
  [1, '3.0.0.1'],
  [65535, '3.0.0.65535'],
  [65536, '3.0.1.0'],
  [4294967295, '3.0.65535.65535'],
])('release %s is a valid increasing browser version', (sequence, version) => {
  expect(getReleaseVersion(sequence)).toBe(version);
});

test.each([undefined, '', 0, -1, 1.5, '1x', 4294967296])('rejects invalid release sequence %s', sequence => {
  expect(() => getReleaseVersion(sequence)).toThrow();
});

test.each([
  ['3.0.1.0', '3.0.0.65535', true],
  ['3.0.0.10', '3.0.0.9', true],
  ['3.0.0.9', '3.0.0.10', false],
  ['3.0.0.10', '3.0.0.10', false],
])('version comparison prevents latest-release downgrades', (next, previous, newer) => {
  expect(isNewerVersion(next, previous)).toBe(newer);
});

test.each([2, 3])('MV%s uses the fork key and a stable release feed', manifestVersion => {
  const manifest = {
    manifest_version: manifestVersion,
    version: '3.0.0.1',
    name: 'Violentmonkey BETA',
    [manifestVersion === 3 ? 'action' : 'browser_action']: { default_popup: 'popup.html' },
    ...(manifestVersion === 2 && { browser_specific_settings: { gecko: { id: 'upstream', strict_min_version: '68.0' } } }),
  };
  configureManifest(manifest);
  expect(manifest.name).toBe('Violentmonkey (Astrophage)');
  expect(manifest.key).toBe(key.toString('base64'));
  expect(manifest.update_url).toBe(`${baseUrl}/latest/download/${manifestVersion === 2 ? 'updates-crx.xml' : 'updates-mv3.xml'}`);
  if (manifestVersion === 2) {
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: 'violentmonkey@astrophage.io',
      strict_min_version: '68.0',
      update_url: `${baseUrl}/latest/download/updates.json`,
    });
  } else {
    expect(manifest.browser_specific_settings).toBeUndefined();
  }
});

test('both browser feeds identify the fork and reference immutable matching packages', () => {
  const manifest = { version: '3.0.0.1', minimum_chrome_version: '86.0' };
  const xpiHash = 'a'.repeat(64);
  const feeds = buildFeeds(manifest, xpiHash);
  expect(feeds['updates.json']).toEqual({
    addons: {
      'violentmonkey@astrophage.io': {
        updates: [{
          version: '3.0.0.1',
          update_link: `${baseUrl}/download/astrophage-v3.0.0.1/violentmonkey-orion.xpi`,
          update_hash: `sha256:${xpiHash}`,
        }],
      },
    },
  });
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 32);
  const appId = digest.replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  expect(getCrxId()).toBe(appId);
  expect(feeds['updates-crx.xml']).toContain(`appid="${appId}"`);
  expect(feeds['updates-crx.xml']).toContain(`${baseUrl}/download/astrophage-v3.0.0.1/violentmonkey-mv2.crx`);
  expect(feeds['updates-crx.xml']).toContain('version="3.0.0.1"');
  expect(feeds['updates-crx.xml']).toContain('prodversionmin="86.0"');
  expect(feeds['updates-mv3.xml']).toContain('/violentmonkey-mv3.crx');
  expect(feeds['updates-mv3.xml']).toContain('prodversionmin="135.0"');
});

test('signing cannot silently replace the extension identity', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await expect(packageRelease({ privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }))
  .rejects.toThrow('Signing key does not match');
});

test('the real manifest build routes both formats to Astrophage releases', () => {
  const before = { ...process.env };
  try {
    process.env.TARGET = 'astrophage';
    process.env.VERSION = '3.0.0.2';
    for (const mv of [2, 3]) {
      process.env.MV3 = mv === 3 ? '1' : '';
      jest.isolateModules(() => {
        const manifest = require('../../scripts/manifest-helper').buildManifest();
        expect(manifest.manifest_version).toBe(mv);
        expect(manifest.version).toBe('3.0.0.2');
        expect(manifest.key).toBe(key.toString('base64'));
        expect(manifest.update_url).toContain('Astrophage-IO/violentmonkey/releases/latest/download/');
      });
    }
  } finally {
    process.env = before;
  }
});
