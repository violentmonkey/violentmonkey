const { readFileSync } = require('fs');
const { resolve } = require('path');

function assertContains(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message);
  }
}

function assertNotContains(text, pattern, message) {
  if (pattern.test(text)) {
    throw new Error(message);
  }
}

function run() {
  const tabRedirector = readFileSync(resolve('src/background/utils/tab-redirector.js'), 'utf8');
  const preinject = readFileSync(resolve('src/background/utils/preinject.js'), 'utf8');
  const injectContent = readFileSync(resolve('src/injected/content/inject.js'), 'utf8');
  const contentIndex = readFileSync(resolve('src/injected/content/index.js'), 'utf8');

  assertContains(
    tabRedirector,
    /return\s+CAN_BLOCK_INSTALL_INTERCEPT\s*&&\s*\{\s*redirectUrl:\s*'about:blank'\s*\}/,
    'tab-redirector: install interception must use about:blank handoff',
  );
  assertNotContains(
    tabRedirector,
    /redirectUrl:\s*'javascript:void 0'/,
    'tab-redirector: javascript: redirect fallback must not be used',
  );

  assertContains(
    injectContent,
    /src:\s*'about:blank'/,
    'inject: iframe bootstrap must use about:blank',
  );
  assertNotContains(
    injectContent,
    /src:\s*'javascript:void 0'/,
    'inject: javascript: iframe bootstrap must not be used',
  );
  assertContains(
    injectContent,
    /const\s+IS_CHROMIUM_MV3\s*=\s*chrome\.runtime\.getManifest\(\)\.manifest_version\s*===\s*3;/,
    'inject: Chromium MV3 guard constant must exist for CSP-safe fallback control',
  );
  assertContains(
    injectContent,
    /export\s+function\s+injectPageSandbox\(data\)\s*\{\s*if\s*\(IS_CHROMIUM_MV3\)\s*\{\s*pageInjectable\s*=\s*false;\s*return\s*false;\s*\}/,
    'inject: injectPageSandbox must hard-stop on Chromium MV3 to avoid inline page bootstrap',
  );
  assertContains(
    injectContent,
    /\}\s*else if\s*\(IS_CHROMIUM_MV3\)\s*\{\s*\/\/ Chromium MV3 blocks inline script in this sandboxed about:blank iframe path\./,
    'inject: Chromium MV3 must skip iframe fallback path that emits CSP inline errors',
  );
  assertContains(
    injectContent,
    /if\s*\(isXml\s*\|\|\s*data\[FORCE_CONTENT\]\s*\|\|\s*forceContentByMeta\s*\|\|\s*IS_CHROMIUM_MV3\)\s*\{\s*pageInjectable\s*=\s*false;/,
    'inject: Chromium MV3 must force content-realm and skip page-mode injection bootstrap',
  );
  assertContains(
    injectContent,
    /const\s+forceContentByMeta\s*=\s*!isXml\s*&&\s*hasStrictMetaCsp\(\);[\s\S]*?if\s*\(isXml\s*\|\|\s*data\[FORCE_CONTENT\]\s*\|\|\s*forceContentByMeta(?:\s*\|\|\s*IS_CHROMIUM_MV3)?\)/,
    'inject: strict meta CSP must force content-realm before page handshake',
  );
  assertContains(
    injectContent,
    /nonce\s*=\s*data\.nonce\s*\|\|\s*getPageNonce\(\);/,
    'inject: page handshake must fallback to DOM nonce when header nonce is unavailable',
  );
  assertContains(
    contentIndex,
    /const\s+IS_CHROMIUM_MV3\s*=\s*chrome\.runtime\.getManifest\(\)\.manifest_version\s*===\s*3;/,
    'content index: Chromium MV3 guard constant must exist for expose/page bootstrap gating',
  );
  assertContains(
    contentIndex,
    /if\s*\(!IS_CHROMIUM_MV3\s*&&\s*data\[EXPOSE\]\s*!?=\s*null\s*&&\s*!isXml\s*&&\s*injectPageSandbox\(data\)\)/,
    'content index: expose bootstrap must be disabled in Chromium MV3 to avoid inline CSP path',
  );

  assertContains(
    preinject,
    /async\s+InjectionFeedback\([\s\S]*?\}\s*,\s*src\)\s*\{[\s\S]*?const\s+isTop\s*=\s*src\[kTop\];/,
    'preinject: InjectionFeedback must capture src[kTop] for frame-aware follow-up processing',
  );
  assertContains(
    preinject,
    /const\s+CSP_HINT_WAIT_MS\s*=\s*\d+;/,
    'preinject: CSP hint wait window must be defined to avoid MV3 GetInjected races',
  );
  assertContains(
    preinject,
    /if\s*\(IS_MV3\s*&&\s*tabId\s*>=\s*0\)\s*\{[\s\S]*?const\s+cspHint\s*=\s*cspHints\[cspHintKey\];[\s\S]*?if\s*\(cspHint\)\s*\{[\s\S]*?applyCspResultToBag\([\s\S]*?\}[\s\S]*?waitForCspHint\(cspHintKey\)\.then\(/,
    'preinject: MV3 GetInjected must apply available CSP hints immediately and handle late hints asynchronously',
  );
  assertNotContains(
    preinject,
    /await\s+waitForCspHint\(cspHintKey\)/,
    'preinject: MV3 GetInjected must not block on CSP hints',
  );
  assertContains(
    preinject,
    /function\s+publishCspHint\(key,\s*hint,\s*source\s*=\s*'unknown'\)\s*\{/,
    'preinject: CSP hint publisher must exist to resolve pending waiters',
  );
  assertContains(
    preinject,
    /function\s+waitForCspHint\(key\)\s*\{/,
    'preinject: CSP hint waiter must exist for MV3 race mitigation',
  );
  assertContains(
    preinject,
    /publishCspHint\(getCspHintKey\(info\.tabId,\s*info\.url\),\s*cspResult,\s*'headers'\);/,
    'preinject: CSP header detector must publish hints through waiter-aware path',
  );
  assertContains(
    preinject,
    /publishCspHint\(key,\s*\{\s*forceContent:\s*true\s*\},\s*'feedback'\);/,
    'preinject: InjectionFeedback must publish forceContent hints with source tagging',
  );
  assertContains(
    preinject,
    /preinject\.cspHint\.wait\.timeout/,
    'preinject: CSP hint waiter timeout lifecycle logging is missing',
  );
  assertContains(
    preinject,
    /if\s*\(!bag\s*&&\s*IS_MV3\s*&&\s*!skippedTabs\[info\.tabId\]\)\s*\{[\s\S]*?bag\s*=\s*prepare\(key,\s*info\.url,\s*isTop\);[\s\S]*?\}/,
    'preinject: MV3 onHeadersReceived must prewarm cache on miss',
  );
  assertContains(
    preinject,
    /if\s*\(env\.nonce\)\s*\{\s*inject\.nonce\s*=\s*env\.nonce;\s*\}/,
    'preinject: prepareBag must carry nonce hint from prewarm env',
  );
  assertContains(
    preinject,
    /if\s*\(env\[FORCE_CONTENT\]\)\s*\{\s*bag\[FORCE_CONTENT\]\s*=\s*inject\[FORCE_CONTENT\]\s*=\s*true;\s*\}/,
    'preinject: prepareBag must carry forceContent hint from prewarm env',
  );
  assertContains(
    preinject,
    /const\s+hasInjectData\s*=\s*!!bag\[INJECT\]\?\.\[SCRIPTS\];/,
    'preinject: strict-CSP detection must guard placeholder bags',
  );

  console.log('MV3 CSP contract checks passed.');
}

run();
