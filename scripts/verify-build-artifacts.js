const { readFile } = require('fs').promises;
const { resolve } = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readManifest(rootDir, dir) {
  const file = resolve(rootDir, dir, 'manifest.json');
  const raw = await readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
}

function checkMv3Manifest(manifest, dir) {
  const minChrome = parseInt(`${manifest.minimum_chrome_version || ''}`, 10) || 0;
  const contentScripts = manifest.content_scripts || [];
  const contentJs = contentScripts.flatMap(item => item.js || []);
  assert(manifest.manifest_version === 3, `${dir}: expected manifest_version=3`);
  assert(manifest.action, `${dir}: expected action in MV3 manifest`);
  assert(!manifest.browser_action, `${dir}: browser_action must be absent in MV3 manifest`);
  assert(manifest.background?.service_worker, `${dir}: expected background.service_worker in MV3 manifest`);
  assert(!manifest.background?.scripts, `${dir}: background.scripts must be absent in MV3 manifest`);
  assert(manifest.permissions?.includes('scripting'), `${dir}: expected scripting permission in MV3 manifest`);
  assert(manifest.permissions?.includes('declarativeNetRequest'), `${dir}: expected declarativeNetRequest permission in MV3 manifest`);
  assert(manifest.permissions?.includes('offscreen'), `${dir}: expected offscreen permission in MV3 manifest`);
  assert(manifest.permissions?.includes('userScripts'), `${dir}: expected userScripts permission in MV3 manifest`);
  assert(!manifest.permissions?.includes('webRequestBlocking'), `${dir}: webRequestBlocking must be absent in MV3 manifest`);
  assert(contentJs.includes('injected.js'), `${dir}: expected injected.js in MV3 content_scripts`);
  assert(contentJs.includes('injected-web.js'), `${dir}: expected injected-web.js in MV3 content_scripts`);
  assert(minChrome >= 135, `${dir}: expected minimum_chrome_version >= 135.0 for userScripts.execute support`);
}

function checkMv2Manifest(manifest, dir) {
  assert(manifest.manifest_version === 2, `${dir}: expected manifest_version=2`);
  assert(manifest.browser_action, `${dir}: expected browser_action in MV2 manifest`);
}

async function verifyMv3(rootDir = 'dist-builds') {
  for (const dir of ['chrome-mv3']) {
    checkMv3Manifest(await readManifest(rootDir, dir), dir);
  }
}

async function verifyDual(rootDir = 'dist-builds') {
  await verifyMv3(rootDir);
  for (const dir of ['chrome', 'firefox', 'opera']) {
    checkMv2Manifest(await readManifest(rootDir, dir), dir);
  }
}

async function run(mode = 'mv3', rootDir = 'dist-builds') {
  const normalizedMode = `${mode}`.toLowerCase();
  if (!['mv3', 'dual'].includes(normalizedMode)) {
    throw new Error(`Unsupported mode "${normalizedMode}". Use "mv3" or "dual".`);
  }
  await (normalizedMode === 'dual' ? verifyDual(rootDir) : verifyMv3(rootDir));
  return normalizedMode;
}

module.exports = {
  assert,
  checkMv2Manifest,
  checkMv3Manifest,
  run,
  verifyDual,
  verifyMv3,
};

if (require.main === module) {
  run(process.argv[2] || 'mv3')
    .then((mode) => {
      console.log(`Artifact verification passed (${mode}).`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
