const { buildManifest } = require('../../scripts/manifest-helper');

const ENV_KEYS = ['TARGET_BROWSER', 'TARGET_MANIFEST', 'TARGET'];
const envSnapshot = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

function restoreEnv() {
  ENV_KEYS.forEach((key) => {
    const value = envSnapshot[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  });
}

afterEach(() => {
  restoreEnv();
});

test('buildManifest keeps MV2 by default', async () => {
  delete process.env.TARGET_BROWSER;
  delete process.env.TARGET_MANIFEST;
  const manifest = await buildManifest();
  expect(manifest.manifest_version).toBe(2);
  expect(manifest.browser_action).toBeTruthy();
  expect(manifest.action).toBeFalsy();
  const allJs = (manifest.content_scripts || []).flatMap(script => script.js || []);
  expect(allJs).toContain('injected-web.js');
  expect(allJs).toContain('injected.js');
});

test('buildManifest transforms Chromium target to MV3', async () => {
  process.env.TARGET_BROWSER = 'chrome';
  process.env.TARGET_MANIFEST = 'mv3';
  const manifest = await buildManifest();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.action).toBeTruthy();
  expect(manifest.browser_action).toBeFalsy();
  expect(manifest.background?.service_worker).toBeTruthy();
  expect(manifest.permissions).toContain('scripting');
  expect(manifest.permissions).toContain('declarativeNetRequest');
  expect(manifest.permissions).toContain('offscreen');
  expect(manifest.permissions).toContain('userScripts');
  expect(manifest.permissions).not.toContain('webRequestBlocking');
  expect(manifest.host_permissions).toEqual(expect.arrayContaining([
    'http://*/*',
    'https://*/*',
    'file:///*',
  ]));
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.minimum_chrome_version).toBe('135.0');
  const allJs = (manifest.content_scripts || []).flatMap(script => script.js || []);
  expect(allJs).toContain('injected.js');
  expect(allJs).toContain('injected-web.js');
});

test('buildManifest rejects MV3 on Firefox target', async () => {
  process.env.TARGET_BROWSER = 'firefox';
  process.env.TARGET_MANIFEST = 'mv3';
  await expect(buildManifest()).rejects.toThrow('TARGET_MANIFEST=mv3 requires TARGET_BROWSER=chrome|opera');
});
