const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { run } = require('../../scripts/verify-build-artifacts');

function writeManifest(root, dir, data) {
  const outDir = join(root, 'dist-builds', dir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(data), 'utf8');
}

describe('verify-build-artifacts', () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'vm-artifacts-'));
  });

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  test('passes in mv3 mode for chromium mv3 manifests', async () => {
    const mv3 = {
      manifest_version: 3,
      action: { default_title: 'x' },
      background: { service_worker: 'background/index.js' },
      content_scripts: [{ js: ['injected-web.js', 'injected.js'] }],
      minimum_chrome_version: '135.0',
      permissions: ['storage', 'scripting', 'declarativeNetRequest', 'offscreen', 'userScripts'],
    };
    writeManifest(workDir, 'chrome-mv3', mv3);
    await expect(run('mv3', join(workDir, 'dist-builds'))).resolves.toBe('mv3');
  });

  test('passes in dual mode for mv2 + mv3 manifests', async () => {
    const mv3 = {
      manifest_version: 3,
      action: { default_title: 'x' },
      background: { service_worker: 'background/index.js' },
      content_scripts: [{ js: ['injected-web.js', 'injected.js'] }],
      minimum_chrome_version: '135.0',
      permissions: ['storage', 'scripting', 'declarativeNetRequest', 'offscreen', 'userScripts'],
    };
    const mv2 = {
      manifest_version: 2,
      browser_action: { default_title: 'x' },
    };
    writeManifest(workDir, 'chrome-mv3', mv3);
    writeManifest(workDir, 'chrome', mv2);
    writeManifest(workDir, 'firefox', mv2);
    writeManifest(workDir, 'opera', mv2);
    await expect(run('dual', join(workDir, 'dist-builds'))).resolves.toBe('dual');
  });

  test('fails when mv3 manifest misses required fields', async () => {
    writeManifest(workDir, 'chrome-mv3', {
      manifest_version: 3,
      background: { service_worker: 'background/index.js' },
      permissions: ['storage'],
    });
    await expect(run('mv3', join(workDir, 'dist-builds'))).rejects.toThrow('expected action in MV3 manifest');
  });

  test('fails when mv3 minimum_chrome_version is below userscripts execute requirement', async () => {
    writeManifest(workDir, 'chrome-mv3', {
      manifest_version: 3,
      action: { default_title: 'x' },
      background: { service_worker: 'background/index.js' },
      content_scripts: [{ js: ['injected-web.js', 'injected.js'] }],
      minimum_chrome_version: '134.0',
      permissions: ['storage', 'scripting', 'declarativeNetRequest', 'offscreen', 'userScripts'],
    });
    await expect(run('mv3', join(workDir, 'dist-builds'))).rejects.toThrow('minimum_chrome_version >= 135.0');
  });

  test('fails when mv3 manifest misses injected-web.js in content scripts', async () => {
    writeManifest(workDir, 'chrome-mv3', {
      manifest_version: 3,
      action: { default_title: 'x' },
      background: { service_worker: 'background/index.js' },
      content_scripts: [{ js: ['injected.js'] }],
      minimum_chrome_version: '135.0',
      permissions: ['storage', 'scripting', 'declarativeNetRequest', 'offscreen', 'userScripts'],
    });
    await expect(run('mv3', join(workDir, 'dist-builds'))).rejects.toThrow('expected injected-web.js in MV3 content_scripts');
  });
});
