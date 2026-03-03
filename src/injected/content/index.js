import bridge, { addBackgroundHandlers, addHandlers, onScripts } from './bridge';
import { onClipboardCopy } from './clipboard';
import { injectPageSandbox, injectScripts } from './inject';
import './notifications';
import './requests';
import './tabs';
import { sendCmd } from './util';
import { isEmpty, XHR_COOKIE_RE } from '../util';
import { Run, finish } from './cmd-run';

const { [IDS]: ids } = bridge;
const IS_CHROMIUM_MV3 = chrome.runtime.getManifest().manifest_version === 3;
const GET_INJECTED_TIMEOUT_MS = 1500;
const GET_INJECTED_MAX_ATTEMPTS = 2;
const SW_PING_TIMEOUT_MS = 1000;
// Torn pages can be heavy; give the MAIN-world bridge more time to respond.
const MAIN_BRIDGE_TIMEOUT_MS = 4000;
const bootstrapState = {
  navigationType: getNavigationType(),
  swPingState: 'pending',
  swPingRttMs: 0,
  swPingError: '',
  mainBridgeState: 'pending',
  mainBridgeRttMs: 0,
  mainBridgeUrl: '',
  mainBridgeError: '',
  getInjectedRttMs: 0,
  getInjectedAttempts: 0,
  lastRuntimeError: '',
};
bridge.bootstrap = bootstrapState;

// Make sure to call obj::method() in code that may run after CONTENT userscripts
async function init() {
  logBootstrap('injected-load', { href: location.href });
  const swHealthPromise = probeServiceWorkerHealth();
  const mainBridgePromise = IS_CHROMIUM_MV3 && probeMainBridgeHealth();
  // Hold a port open so the service worker stays alive for the entire injection
  // sequence (GetInjected → executeScripts). Disconnected once injectScripts() resolves.
  let keepalivePort = null;
  if (IS_CHROMIUM_MV3) {
    try { keepalivePort = chrome.runtime.connect({ name: 'vm-keepalive' }); } catch { /* SW dead, health probe will report it */ }
  }
  const isXml = document instanceof XMLDocument;
  const xhrData = getXhrInjection();
  const dataPromise = getInjectedData({
    /* In FF93 sender.url is wrong: https://bugzil.la/1734984,
     * in Chrome sender.url is ok, but location.href is wrong for text selection URLs #:~:text= */
    url: IS_FIREFOX && location.href,
    // XML document's appearance breaks when script elements are added
    [FORCE_CONTENT]: isXml,
    done: !!(xhrData || global.vmData),
  });
  // detecting if browser.contentScripts is usable, it was added in FF59 as well as composedPath
  /** @type {VMInjection} */
  const data = xhrData || (
    IS_FIREFOX && Event[PROTO].composedPath
      ? await getDataFF(dataPromise)
      : await dataPromise
  );
  const info = data.info || createNullObj();
  const injectInto = bridge[INJECT_INTO] = data[INJECT_INTO] || 'off';
  assign(ids, data[IDS]);
  logBootstrap('after-get-injected', {
    injectInto,
    scriptCount: data[SCRIPTS]?.length || 0,
    idsCount: objectKeys(data[IDS] || {}).length,
    swPingState: bridge.bootstrap?.swPingState,
    swPingRttMs: bridge.bootstrap?.swPingRttMs || 0,
    mainBridgeState: bridge.bootstrap?.mainBridgeState,
    mainBridgeRttMs: bridge.bootstrap?.mainBridgeRttMs || 0,
    getInjectedRttMs: bridge.bootstrap?.getInjectedRttMs || 0,
  });
  if (IS_FIREFOX && !data.clipFF) {
    off('copy', onClipboardCopy, true);
  }
  if (IS_FIREFOX && info) { // must redefine now as it's used by injectPageSandbox
    IS_FIREFOX = parseFloat(info.ua.browserVersion); // eslint-disable-line no-global-assign
  }
  if (!IS_CHROMIUM_MV3 && data[EXPOSE] != null && !isXml && injectPageSandbox(data)) {
    addHandlers({ GetScriptVer: true });
    bridge.post('Expose', data[EXPOSE]);
  }
  if (objectKeys(ids).length) {
    logBootstrap('before-script-dispatch', {
      scriptCount: data[SCRIPTS]?.length || 0,
      injectInto,
    });
    onScripts.forEach(fn => fn(data));
    await injectScripts(data, info, isXml);
  }
  onScripts.length = 0;
  if (keepalivePort) {
    try { keepalivePort.disconnect(); } catch { /* ignore */ }
    keepalivePort = null;
  }
  void swHealthPromise;
  void mainBridgePromise;
  finish(injectInto);
}

addBackgroundHandlers({
  [VIOLENTMONKEY]: () => true,
}, true);

addBackgroundHandlers({
  Command: data => bridge.post('Command', data, ids[data.id]),
  Run: id => Run(id, CONTENT),
  UpdatedValues(data) {
    const dataPage = createNullObj();
    const dataContent = createNullObj();
    objectKeys(data)::forEach((id) => {
      (ids[id] === CONTENT ? dataContent : dataPage)[id] = data[id];
    });
    if (!isEmpty(dataPage)) bridge.post('UpdatedValues', dataPage);
    if (!isEmpty(dataContent)) bridge.post('UpdatedValues', dataContent, CONTENT);
  },
});

addHandlers({
  Log: data => safeApply(logging[data[0]], logging, data[1]),
  DiagnosticsLogScriptIssue: true,
  ScriptEntered(data) {
    if (data?.id) {
      Run(data.id, CONTENT);
      logBootstrap('script-entered', {
        scriptId: data.id,
        injectInto: data.injectInto,
        bridgeReady: data.bridgeReady,
      });
    }
  },
  ScriptFailedToStart(data) {
    if (data?.scriptId) {
      Run(data.scriptId, CONTENT);
    }
    const payload = getBootstrapDetails(data || createNullObj());
    logBootstrap('script-failed-to-start', {
      scriptId: payload?.scriptId,
      injectInto: payload?.injectInto,
      reason: payload?.reason,
      swPingState: payload?.swPingState,
      mainBridgeState: payload?.mainBridgeState,
    });
    return sendCmd('DiagnosticsLogScriptIssue', payload, { retry: true });
  },
  TabFocus: REIFY,
  UpdateValue: REIFY,
});

init().catch(IS_FIREFOX && logging.error); // Firefox can't show exceptions in content scripts

async function getDataFF(viaMessaging) {
  // global !== window in FF content scripts
  const data = global.vmData || await SafePromise.race([
    new SafePromise(resolve => { global.vmResolve = resolve; }),
    viaMessaging,
  ]);
  delete global.vmResolve;
  delete global.vmData;
  return data;
}

function logBootstrap(stage, details) {
  if (process.env.DEBUG) {
    logging.info('[vm.bootstrap]', stage, details || '');
  }
}

function getNavigationType() {
  try {
    const type = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (type) return type;
  } catch { /* NOP */ }
  const legacyType = performance?.navigation?.type;
  return legacyType === 1 ? 'reload'
    : legacyType === 2 ? 'back_forward'
      : legacyType === 255 ? 'prerender'
        : 'navigate';
}

function updateBootstrapState(updates) {
  assign(bootstrapState, updates);
  bridge.bootstrap = bootstrapState;
}

function getBootstrapDetails(details) {
  const state = bridge.bootstrap || bootstrapState;
  return {
    ...details,
    navigationType: state.navigationType || '',
    swPingState: state.swPingState || '',
    swPingRttMs: state.swPingRttMs || 0,
    swPingError: state.swPingError || '',
    mainBridgeState: state.mainBridgeState || '',
    mainBridgeRttMs: state.mainBridgeRttMs || 0,
    mainBridgeUrl: state.mainBridgeUrl || '',
    mainBridgeError: state.mainBridgeError || '',
    lastBgResponseMs: state.getInjectedRttMs || 0,
    getInjectedAttempts: state.getInjectedAttempts || 0,
    lastRuntimeError: state.lastRuntimeError || '',
  };
}

function getInjectionFallback(reason) {
  return {
    [IDS]: createNullObj(),
    [INJECT_INTO]: 'off',
    info: createNullObj(),
    [SCRIPTS]: [],
    errors: reason || '',
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return new SafePromise((resolve, reject) => {
    timer = setTimeout(() => reject(new SafeError(message)), timeoutMs);
    promise::then((data) => {
      clearTimeout(timer);
      resolve(data);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function getInjectedData(payload) {
  let lastError;
  const timeoutMessage = `GetInjected timeout (${GET_INJECTED_TIMEOUT_MS}ms)`;
  for (let attempt = 1; attempt <= GET_INJECTED_MAX_ATTEMPTS; attempt += 1) {
    const startedAt = performance.now();
    try {
      logBootstrap('before-get-injected', { attempt });
      const result = await withTimeout(sendCmd('GetInjected', payload, { retry: true }),
        GET_INJECTED_TIMEOUT_MS, timeoutMessage);
      updateBootstrapState({
        getInjectedAttempts: attempt,
        getInjectedRttMs: Math.round(performance.now() - startedAt),
        lastRuntimeError: '',
      });
      return result;
    } catch (error) {
      lastError = error;
      updateBootstrapState({
        getInjectedAttempts: attempt,
        lastRuntimeError: `${error?.message || error || ''}`,
      });
      logBootstrap('get-injected-failed', {
        attempt,
        error: `${error?.message || error || ''}`,
      });
    }
  }
  const reason = 'SW timeout';
  const detail = `${lastError?.message || lastError || timeoutMessage}`;
  void sendCmd('DiagnosticsLogScriptIssue', getBootstrapDetails({
    scriptId: 0,
    scriptName: '',
    runAt: 'document_start',
    realm: CONTENT,
    state: ID_INJECTING,
    phase: 'get-injected',
    checkPhase: 'sw-timeout',
    reason,
    pageUrl: location.href,
    fingerprint: ['get-injected-timeout', location.href].join('|'),
    bootstrapError: {
      message: reason,
      detail,
    },
  }), {
    retry: true,
  }).catch(() => {});
  return getInjectionFallback(`${reason}: ${detail}`);
}

async function probeServiceWorkerHealth() {
  const startedAt = performance.now();
  try {
    await withTimeout(sendCmd('HealthPing', {
      href: location.href,
      navigationType: bootstrapState.navigationType,
    }, { retry: true }), SW_PING_TIMEOUT_MS, `HealthPing timeout (${SW_PING_TIMEOUT_MS}ms)`);
    updateBootstrapState({
      swPingState: 'ok',
      swPingRttMs: Math.round(performance.now() - startedAt),
      swPingError: '',
    });
    logBootstrap('sw-health-ping', {
      state: 'ok',
      rttMs: bridge.bootstrap?.swPingRttMs || 0,
    });
  } catch (error) {
    const message = `${error?.message || error || ''}`;
    updateBootstrapState({
      swPingState: 'failed',
      swPingError: message,
      lastRuntimeError: message,
    });
    logBootstrap('sw-health-ping-failed', { error: message });
  }
}

async function probeMainBridgeHealth() {
  const startedAt = performance.now();
  try {
    const data = await withTimeout(sendCmd('MainBridgePing', null, { retry: true }),
      MAIN_BRIDGE_TIMEOUT_MS, `MainBridgePing timeout (${MAIN_BRIDGE_TIMEOUT_MS}ms)`);
    const state = `${data?.state || 'unknown'}`;
    updateBootstrapState({
      mainBridgeState: state,
      mainBridgeRttMs: Math.round(performance.now() - startedAt),
      mainBridgeUrl: `${data?.url || ''}`,
      mainBridgeError: state === 'error' ? `${data?.message || ''}` : '',
    });
    logBootstrap('main-bridge-ping', {
      state,
      rttMs: bridge.bootstrap?.mainBridgeRttMs || 0,
      url: bridge.bootstrap?.mainBridgeUrl || '',
    });
  } catch (error) {
    const message = `${error?.message || error || ''}`;
    updateBootstrapState({
      mainBridgeState: 'error',
      mainBridgeError: message,
      lastRuntimeError: message,
    });
    logBootstrap('main-bridge-ping-failed', { error: message });
  }
}

function getXhrInjection() {
  try {
    const key = VM_UUID.match(XHR_COOKIE_RE)[1];
    // Accessing document.cookie may throw due to CSP sandbox
    const cookieValue = document.cookie.split(`${key}=`)[1];
    const blobId = cookieValue && cookieValue.split(';', 1)[0];
    if (blobId) {
      document.cookie = `${key}=0; max-age=0; SameSite=Lax`; // this removes our cookie
      const xhr = new XMLHttpRequest();
      const url = `blob:${VM_UUID}${blobId}`;
      xhr.open('get', url, false); // `false` = synchronous
      xhr.send();
      URL.revokeObjectURL(url);
      return JSON.parse(xhr[kResponse]);
    }
  } catch { /* NOP */ }
}
