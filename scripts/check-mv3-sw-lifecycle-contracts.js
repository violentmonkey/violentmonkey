const { readFileSync } = require('fs');
const { resolve } = require('path');

function assertContains(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message);
  }
}

function run() {
  const background = readFileSync(resolve('src/background/index.js'), 'utf8');
  const tabs = readFileSync(resolve('src/background/utils/tabs.js'), 'utf8');
  const diagnostics = readFileSync(resolve('src/background/utils/diagnostics.js'), 'utf8');
  const init = readFileSync(resolve('src/background/utils/init.js'), 'utf8');

  assertContains(
    background,
    /browser\.runtime\.onMessage\.addListener\(handleCommandMessage\);/,
    'sw-lifecycle: runtime.onMessage listener must be registered at module load',
  );
  assertContains(
    background,
    /browser\.commands\?\.onCommand\.addListener\(/,
    'sw-lifecycle: commands listener must be registered at module load',
  );
  assertContains(
    diagnostics,
    /browser\.runtime\.onInstalled\?\.addListener\(/,
    'sw-lifecycle: onInstalled listener must be registered for startup diagnostics',
  );
  assertContains(
    diagnostics,
    /browser\.runtime\.onStartup\?\.addListener\(/,
    'sw-lifecycle: onStartup listener must be registered for startup diagnostics',
  );
  assertContains(
    diagnostics,
    /browser\.runtime\.onSuspend\?\.addListener\(/,
    'sw-lifecycle: onSuspend listener must be registered for shutdown diagnostics',
  );
  assertContains(
    tabs,
    /if\s*\(\s*extensionManifest\.manifest_version\s*===\s*3\s*\)\s*\{[\s\S]*?void\s+cleanupStaleUserScriptsAtStartup\(\);[\s\S]*?void\s+getUserScriptsHealth\(true\);[\s\S]*?void\s+ensureMainWorldBridgeRegistration\(\);/,
    'sw-lifecycle: MV3 startup must clean userscripts, refresh health, and ensure main-world bridge registration',
  );
  assertContains(
    tabs,
    /browser\.runtime\.onInstalled\?\.addListener\(\(\)\s*=>\s*\{\s*void\s+ensureMainWorldBridgeRegistration\(true\);\s*\}\);/,
    'sw-lifecycle: MV3 must re-register main-world bridge on install/update',
  );
  assertContains(
    tabs,
    /browser\.runtime\.onStartup\?\.addListener\(\(\)\s*=>\s*\{\s*void\s+ensureMainWorldBridgeRegistration\(\);\s*\}\);/,
    'sw-lifecycle: MV3 must ensure main-world bridge on startup',
  );
  assertContains(
    init,
    /resolveInit\s*=\s*\(\)\s*=>\s*Promise\.all\(init\.deps\)\.then\(r\);/,
    'sw-lifecycle: init dependency barrier must remain Promise-backed',
  );
  console.log('MV3 service-worker lifecycle contract checks passed.');
}

run();
