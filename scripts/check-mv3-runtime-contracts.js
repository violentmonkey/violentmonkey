const { readFileSync } = require('fs');
const { resolve } = require('path');

function assertContains(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message);
  }
}

function run() {
  const installFlow = readFileSync(resolve('src/background/utils/tab-redirector.js'), 'utf8');
  const syncFlow = readFileSync(resolve('src/background/sync/base.js'), 'utf8');
  const preinjectFlow = readFileSync(resolve('src/background/utils/preinject.js'), 'utf8');
  const injectFlow = readFileSync(resolve('src/injected/content/inject.js'), 'utf8');
  const tabsFlow = readFileSync(resolve('src/background/utils/tabs.js'), 'utf8');
  const backgroundFlow = readFileSync(resolve('src/background/index.js'), 'utf8');
  assertContains(
    installFlow,
    /const\s+CAN_BLOCK_INSTALL_INTERCEPT\s*=\s*IS_FIREFOX\s*\|\|\s*!IS_MV3\s*;/,
    'tab-redirector: missing MV3 install fallback gate',
  );
  assertContains(
    installFlow,
    /tabsOnUpdated\.addListener\s*\(\s*onTabUpdated/,
    'tab-redirector: missing onUpdated fallback for MV3 .user.js installs',
  );
  assertContains(
    syncFlow,
    /const\s+CAN_BLOCK_AUTH_REDIRECT\s*=\s*!IS_MV3\s*;/,
    'sync/base: missing MV3 auth callback fallback gate',
  );
  assertContains(
    syncFlow,
    /browser\.tabs\.onUpdated\.addListener\s*\(\s*handler/,
    'sync/base: missing tabs.onUpdated fallback for MV3 OAuth callback detection',
  );
  assertContains(
    preinjectFlow,
    /const\s+SCRIPT_ENTERED_HOOK\s*=\s*'__VM_SCRIPT_ENTERED__'/,
    'preinject: script-entered ACK hook constant is missing',
  );
  assertContains(
    preinjectFlow,
    /enteredHookCall\s*=\s*`window\.\$\{SCRIPT_ENTERED_HOOK\}&&window\.\$\{SCRIPT_ENTERED_HOOK\}\(\$\{id\}\);`/,
    'preinject: wrapper must inject script-entered ACK call',
  );
  assertContains(
    preinjectFlow,
    /if\s*\(!wrap\)\s*\{\s*injectedCode\.push\(enteredHookCall\);\s*\}/,
    'preinject: unwrap scripts must emit script-entered ACK before user code',
  );
  assertContains(
    preinjectFlow,
    /preferRegister:\s*IS_MV3\s*&&\s*frameId\s*<=\s*0/,
    'preinject: MV3 top-frame content injection must prefer register path',
  );
  assertContains(
    preinjectFlow,
    /allowLegacyCodeFallback:\s*!IS_MV3/,
    'preinject: MV3 content injection must keep legacy execute fallback disabled',
  );
  assertContains(
    injectFlow,
    /if\s*\(\s*typeof\s+VMInitInjection\s*!==\s*'function'\s*\)\s*\{/,
    'inject: missing VMInitInjection availability guard for content bootstrap',
  );
  assertContains(
    injectFlow,
    /checkPhase:\s*'content-invoker-missing'/,
    'inject: missing deterministic content-invoker diagnostics phase',
  );
  assertContains(
    tabsFlow,
    /const\s+allowLegacyCodeFallback\s*=\s*options\.allowLegacyCodeFallback\s*!=\s*null[\s\S]*?extensionManifest\.manifest_version\s*!==\s*3/,
    'tabs: missing MV3 default legacy fallback gate',
  );
  assertContains(
    tabsFlow,
    /if\s*\(\s*!allowLegacyCodeFallback\s*\)\s*return\s*\[\]/,
    'tabs: missing legacy fallback short-circuit',
  );
  assertContains(
    tabsFlow,
    /if\s*\(\s*extensionManifest\.manifest_version\s*===\s*3\s*\)\s*\{[\s\S]*?MV3 string-code fallback is disabled/,
    'tabs: MV3 string-code fallback disable guard is missing',
  );
  assertContains(
    tabsFlow,
    /const\s+MAIN_WORLD_BRIDGE_OPTIONS\s*=\s*\{[\s\S]*?js:\s*\['injected-web\.js'\],[\s\S]*?world:\s*'MAIN'/,
    'tabs: MV3 main-world bridge registration options are missing',
  );
  assertContains(
    tabsFlow,
    /export\s+async\s+function\s+ensureMainWorldBridgeRegistration\(/,
    'tabs: missing ensureMainWorldBridgeRegistration export',
  );
  assertContains(
    tabsFlow,
    /async\s+MainBridgePing\(_, src\)\s*\{[\s\S]*?world:\s*'MAIN'[\s\S]*?args:\s*\[\s*MAIN_BRIDGE_INIT_FUNC_NAME\s*\]/,
    'tabs: missing MainBridgePing MAIN-world probe command',
  );
  assertContains(
    backgroundFlow,
    /const\s+payload\s*=\s*message\s*&&\s*typeof\s+message\s*===\s*'object'\s*&&\s*!Array\.isArray\(message\)/,
    'background: command payload object-shape guard is missing',
  );
  assertContains(
    backgroundFlow,
    /command\.rejected\.invalidPayload/,
    'background: invalid payload rejection telemetry is missing',
  );
  assertContains(
    backgroundFlow,
    /typeof\s+cmd\s*!==\s*'string'\s*\|\|\s*!cmd\s*\|\|\s*cmd\.length\s*>\s*128/,
    'background: command name validation guard is missing',
  );
  assertContains(
    backgroundFlow,
    /if\s*\(\s*!me\s*&&\s*func\.isOwn\s*&&\s*!src\.fake\s*\)\s*\{\s*throw\s+new\s+SafeError\(`Command is only allowed in extension context: \$\{cmd\}`\);\s*\}/,
    'background: isOwn extension-origin guard is missing',
  );
  console.log('MV3 runtime contract checks passed.');
}

run();
