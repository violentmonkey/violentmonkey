import { browserWindows, getActiveTab, makePause, noop, sendTabCmd } from '@/common';
import { getDomain } from '@/common/tld';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { getOption } from './options';
import { testScript } from './tester';
import { CHROME, FIREFOX } from './ua';
import { vetUrl } from './url';
import { pushAlert } from './alerts';
import { logBackgroundAction } from './diagnostics';

const openers = {};
const openerTabIdSupported = !IS_FIREFOX // supported in Chrome
  || !!(globalThis.AbortSignal && browserWindows); // and FF57+ except mobile
const EDITOR_ROUTE = extensionOptionsPage + ROUTE_SCRIPTS + '/'; // followed by id
export const NEWTAB_URL_RE = re`/
^(
  about:(home|newtab) # Firefox
  | (chrome|edge):\/\/(
    newtab\/ # Chrome, Edge
    | startpageshared\/ # Opera
    | vivaldi-webui\/startpage # Vivaldi
  )
)$
/x`;
/** @returns {string|number} documentId for a pre-rendered top page, frameId otherwise */
export const getFrameDocId = (isTop, docId, frameId) => (
  isTop === 2 && docId || frameId
);
/** @param {VMMessageSender} src */
export const getFrameDocIdFromSrc = src => (
  src[kTop] === 2 && src[kDocumentId] || src[kFrameId]
);
export const getFrameDocIdAsObj = id => +id >= 0
  ? { [kFrameId]: +id }
  : { [kDocumentId]: id };
/**
 * @param {chrome.tabs.Tab} tab
 * @returns {string}
 */
export const getTabUrl = tab => (
  tab.url || tab.pendingUrl || ''
);
export const tabsOnUpdated = browser.tabs.onUpdated;
export const tabsOnRemoved = browser.tabs.onRemoved;
export let injectableRe = /^(https?|file|ftps?):/;
export let fileSchemeRequestable;
const USERSCRIPT_UNREGISTER_DELAY = 30e3;
const USERSCRIPT_HEALTH_TTL = 60e3;
const USERSCRIPT_ONE_SHOT_ID_PREFIX = 'vm-one-shot-';
const USERSCRIPT_DISABLED_RE = /allow user scripts|user scripts? (?:is|are)? ?(?:disabled|not enabled|not allowed)|not been granted permission|access to user scripts|cannot access user scripts/i;
const MAIN_WORLD_BRIDGE_SCRIPT_ID = 'vm-main-bridge';
const MAIN_BRIDGE_INIT_FUNC_NAME = process.env.INIT_FUNC_NAME || '**VMInitInjection**';
// Additive MAIN-world bridge for MV3. The existing isolated-world bootstrap remains active
// so current content startup behavior stays backward-compatible while we migrate bridge usage.
const MAIN_WORLD_BRIDGE_OPTIONS = {
  id: MAIN_WORLD_BRIDGE_SCRIPT_ID,
  matches: ['*://*/*', 'file:///*'],
  js: ['injected-web.js'],
  // Keep this additive bridge off document_start so it won't race/override
  // the isolated-world bootstrap helper consumed during content startup.
  runAt: 'document_end',
  allFrames: true,
  world: 'MAIN',
  persistAcrossSessions: true,
};
let userScriptSeq = 0;
const registeredUserScriptsByTab = new Map();
let staleUserScriptsCleanupApi;
let staleUserScriptsCleanupPromise;
let warnedMissingUserScriptsApi;
let warnedMissingUserScriptsExecute;
let cookieStorePrefix;
let userScriptsHealth = {
  checkedAt: 0,
  detail: '',
  message: '',
  state: 'unknown',
};

try {
  // onUpdated is filterable only in desktop FF 61+
  // but we use a try-catch anyway to detect this feature in nonstandard browsers
  tabsOnUpdated.addListener(noop, { properties: ['status'] });
  tabsOnUpdated.removeListener(noop);
} catch (e) {
  tabsOnUpdated.addListener = new Proxy(tabsOnUpdated.addListener, {
    apply: (fn, thisArg, args) => thisArg::fn(args[0]),
  });
}

addOwnCommands({
  GetTabDomain(url) {
    const host = url && new URL(url).hostname;
    return {
      host,
      domain: host && getDomain(host) || host,
    };
  },
  /**
   * @param {string} [pathId] - path or id: added to #scripts/ route in dashboard,
   * falsy: creates a new script for active tab's URL
   * @param {VMMessageSender} [src]
   */
  async OpenEditor(pathId, src) {
    return openDashboard(`${SCRIPTS}/${
      pathId || `_new/${src?.tab?.id || (await getActiveTab()).id}`
    }`, src);
  },
  async OpenEditorAt(payload, src) {
    const {
      id,
      line,
      column,
      source,
      requireUrl,
    } = payload || {};
    const scriptId = +id;
    if (!Number.isInteger(scriptId) || scriptId <= 0) {
      return commands.OpenEditor(id, src);
    }
    const query = new URLSearchParams();
    const lineNum = +line > 0 ? Math.trunc(+line) : 0;
    const colNum = +column > 0 ? Math.trunc(+column) : 0;
    if (lineNum || colNum) query.set('error', 'syntax');
    if (lineNum) query.set('line', `${lineNum}`);
    if (colNum) query.set('column', `${colNum}`);
    if (source) query.set('source', `${source}`.slice(0, 24));
    if (requireUrl) query.set('requireUrl', `${requireUrl}`.slice(0, 500));
    const queryString = query.toString();
    return openDashboard(queryString
      ? `${SCRIPTS}/${scriptId}?${queryString}`
      : `${SCRIPTS}/${scriptId}`, src);
  },
  OpenDashboard: openDashboard,
});

addPublicCommands({
  /** @return {Promise<{ id: number } | chrome.tabs.Tab>} new tab is returned for internal calls */
  async TabOpen(payload, src = {}) {
    let {
      url,
      active = true,
      container,
      insert = true,
      pinned,
    } = payload || {};
    const isRemoved = src._removed;
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const srcTab = !isRemoved && src.tab
      || await getActiveTab(isRemoved && src.tab[kWindowId])
      || {};
    // src.url may be absent when invoked directly as commands.TabOpen
    const srcUrl = src.url;
    const isInternal = !srcUrl || srcUrl.startsWith(extensionRoot);
    // only incognito storeId may be specified when opening in an incognito window
    const { incognito } = srcTab;
    const canOpenIncognito = !incognito || IS_FIREFOX || !/^(chrome[-\w]*):/.test(url);
    const tabOpts = {
      // normalizing as boolean because the API requires strict types
      active: !!active,
      pinned: !!pinned,
    };
    let windowId = srcTab[kWindowId];
    let newTab;
    // Chrome can't open chrome-xxx: URLs in incognito windows
    // TODO: for src._removed maybe create a new window if cookieStoreId of active tab is different
    let storeId = srcTab.cookieStoreId;
    if (storeId && !incognito) {
      if (!cookieStorePrefix) {
        cookieStorePrefix = (await browser.cookies.getAllCookieStores())[0].id.split('-')[0];
      }
      if (isInternal || container === 0) {
        storeId = cookieStorePrefix + '-default';
      } else if (container > 0) {
        storeId = `${cookieStorePrefix}-container-${container}`;
      }
    }
    if (storeId) storeId = { cookieStoreId: storeId };
    // URL needs to be expanded for `canOpenIncognito` below
    if (!/^[-\w]+:/.test(url)) {
      url = isInternal
        ? browser.runtime.getURL(url)
        : vetUrl(url, srcUrl);
    }
    if (isInternal
        && url.startsWith(EDITOR_ROUTE)
        && browserWindows
        && getOption('editorWindow')
        /* cookieStoreId in windows.create() is supported since FF64 https://bugzil.la/1393570
         * and a workaround is too convoluted to add it for such an ancient version */
        && (!storeId || FIREFOX >= 64)) {
      const wndOpts = {
        url,
        incognito: canOpenIncognito && incognito,
        ...getOption('editorWindowSimple') && { type: 'popup' },
        ...!IS_FIREFOX && { focused: !!active }, // FF doesn't support this
        ...storeId,
      };
      const pos = getOption('editorWindowPos');
      const hasPos = pos && 'top' in pos;
      const wnd = await browserWindows.create({ ...wndOpts, ...pos }).catch(hasPos && noop)
        || hasPos && await browserWindows.create(wndOpts);
      newTab = wnd.tabs[0];
    } else if (isInternal && canOpenIncognito && NEWTAB_URL_RE.test(getTabUrl(srcTab))) {
      // Replacing the currently focused start tab page for internal commands
      newTab = await browser.tabs.update(srcTab.id, { url, ...tabOpts }).catch(noop);
    }
    for (let retry = 0; !newTab && retry < 2; retry++) try {
      newTab = await browser.tabs.create({
        url,
        ...tabOpts,
        ...storeId,
        ...canOpenIncognito && {
          [kWindowId]: windowId,
          ...insert && srcTab.index != null && { index: srcTab.index + 1 },
          ...openerTabIdSupported && { openerTabId: srcTab.id },
        },
      });
    } catch (err) {
      const m = err.message;
      if (m.startsWith('Illegal to set private')) storeId = null;
      else if (m.startsWith('No tab')) srcTab.id = null;
      else if (m.startsWith('No window')) windowId = null;
      else if (m.startsWith('Tabs cannot be edited')) await makePause(100);
      else throw err; // TODO: put in storage and show in UI
    }
    if (active && newTab[kWindowId] !== windowId) {
      await browserWindows?.update(newTab[kWindowId], { focused: true });
    }
    if (!isInternal && srcTab.id != null) {
      openers[newTab.id] = srcTab.id;
    }
    return isInternal ? newTab : { id: newTab.id };
  },
  /** @return {void} */
  TabClose(payload, src) {
    const { id } = payload || {};
    const tabId = id || src?.tab?.id;
    if (tabId >= 0) browser.tabs.remove(tabId);
  },
  TabFocus(_, src) {
    browser.tabs.update(src.tab.id, { active: true }).catch(noop);
    browserWindows?.update(src.tab[kWindowId], { focused: true }).catch(noop);
  },
  async MainBridgePing(_, src) {
    if (extensionManifest.manifest_version !== 3) {
      return { state: 'unsupported' };
    }
    const tabId = src?.tab?.id;
    if (!(tabId >= 0)) {
      return { state: 'no-tab' };
    }
    const frameId = src?.[kFrameId];
    try {
      const [result = {}] = await executeScriptInTab(tabId, {
        ...frameId >= 0 && { [kFrameId]: frameId },
        world: 'MAIN',
        func: key => ({
          ready: typeof globalThis[key] === 'function',
          url: location.href,
        }),
        args: [MAIN_BRIDGE_INIT_FUNC_NAME],
      });
      return {
        state: result.ready ? 'ready' : 'missing',
        url: result.url || '',
      };
    } catch (error) {
      return {
        state: 'error',
        message: `${error?.message || error || ''}`.slice(0, 400),
      };
    }
  },
});

tabsOnUpdated.addListener((id, info) => {
  if (info?.status === 'complete') {
    cleanupRegisteredUserScripts(id);
  }
});

tabsOnRemoved.addListener((id) => {
  cleanupRegisteredUserScripts(id);
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'TabClosed', id);
    delete openers[id];
  }
});

(async () => {
  // FF68+ can't fetch file:// from extension context but it runs content scripts in file:// tabs
  const fileScheme = IS_FIREFOX
    || await new Promise(r => chrome.extension.isAllowedFileSchemeAccess(r));
  fileSchemeRequestable = FIREFOX < 68 || !IS_FIREFOX && fileScheme;
  // Since users in FF can override UA we detect FF 90 via feature
  if (IS_FIREFOX && [].at || CHROME >= 88) {
    injectableRe = fileScheme ? /^(https?|file):/ : /^https?:/;
  } else if (!fileScheme) {
    injectableRe = /^(ht|f)tps?:/;
  }
})();

export async function forEachTab(callback) {
  const tabs = await browser.tabs.query({});
  let i = 0;
  for (const tab of tabs) {
    callback(tab);
    i += 1;
    // we'll run at most this many tabs in one event loop cycle
    // because hundreds of tabs would make our extension process unresponsive,
    // the same process used by our own pages like the background page, dashboard, or popups
    if (i % 20 === 0) await new Promise(setTimeout);
  }
}

/**
 * MV2->MV3 compatibility wrapper for tab script execution.
 * Returns an array of per-frame results like browser.tabs.executeScript.
 */
export async function executeScriptInTab(tabId, options) {
  if (options.tryUserScripts) {
    const userScriptsApi = getUserScriptsApi();
    const canExecuteNow = !!userScriptsApi?.execute;
    if (!userScriptsApi?.execute && !userScriptsApi?.register && !warnedMissingUserScriptsApi) {
      warnedMissingUserScriptsApi = true;
      if (process.env.DEBUG) {
        console.warn('MV3: userScripts API is unavailable; code injection compatibility is limited.');
      }
    }
    if (!userScriptsApi?.execute
    && options.allowRegisterFallback === false
    && options.allowLegacyCodeFallback === false
    && !warnedMissingUserScriptsExecute) {
      warnedMissingUserScriptsExecute = true;
      if (process.env.DEBUG) {
        console.warn('MV3: userScripts.execute is unavailable for a strict no-legacy-fallback path.');
      }
    }
    const canTryRegister = options.allowRegisterFallback !== false && (options[kFrameId] ?? 0) <= 0;
    // `userScripts.register` is not guaranteed to run immediately on the current document.
    // Prefer `userScripts.execute` for one-shot runtime injection, then fallback to register.
    if (canTryRegister && options.preferRegister && !canExecuteNow
    && await registerUserScriptOnce(tabId, options)) {
      return [true];
    }
    const executed = await executeUserScriptCode(tabId, options);
    if (executed?.length) return executed;
    if (canTryRegister
    && await registerUserScriptOnce(tabId, options)) {
      return [true];
    }
    const allowLegacyCodeFallback = options.allowLegacyCodeFallback != null
      ? options.allowLegacyCodeFallback
      : extensionManifest.manifest_version !== 3;
    if (!allowLegacyCodeFallback) return [];
  }
  if (browser.tabs.executeScript) {
    return browser.tabs.executeScript(tabId, options);
  }
  const promiseApi = browser.scripting?.executeScript;
  const callbackApi = chrome.scripting?.executeScript;
  if (!promiseApi && !callbackApi) {
    throw new Error('tabs.executeScript and scripting.executeScript are unavailable');
  }
  const target = { tabId };
  if (options[kFrameId] != null) target.frameIds = [options[kFrameId]];
  if (options.allFrames) target.allFrames = true;
  const injectDetails = { target };
  if (options.world) injectDetails.world = options.world;
  if (options[RUN_AT] === 'document_start') injectDetails.injectImmediately = true;
  if (options.func) {
    injectDetails.func = options.func;
    injectDetails.args = options.args || [];
  } else if (options.file) injectDetails.files = [options.file];
  else if (options.files) injectDetails.files = options.files;
  else {
    if (extensionManifest.manifest_version === 3) {
      throw new Error('MV3 string-code fallback is disabled; use userScripts or file-based injection.');
    }
    injectDetails.func = (source) => {
      // eslint-disable-next-line no-eval
      return eval(source);
    };
    injectDetails.args = [options.code || ''];
  }
  const execViaCallback = () => new Promise((resolve, reject) => {
    callbackApi(injectDetails, (res) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res || []);
    });
  });
  let result;
  if (promiseApi) {
    try {
      const maybeResult = promiseApi(injectDetails);
      if (maybeResult?.then) {
        result = await maybeResult;
      } else if (callbackApi) {
        result = await execViaCallback();
      } else {
        result = maybeResult || [];
      }
    } catch (err) {
      if (!callbackApi) throw err;
      result = await execViaCallback();
    }
  } else {
    result = await execViaCallback();
  }
  return result.map(item => item.result);
}

function getUserScriptsApi() {
  return chrome.userScripts || browser.userScripts;
}

function getScriptingApi() {
  return chrome.scripting || browser.scripting;
}

function isMainWorldBridgeCurrent(entry) {
  return !!entry
    && entry.id === MAIN_WORLD_BRIDGE_OPTIONS.id
    && entry.runAt === MAIN_WORLD_BRIDGE_OPTIONS.runAt
    && entry.allFrames === MAIN_WORLD_BRIDGE_OPTIONS.allFrames
    && entry.world === MAIN_WORLD_BRIDGE_OPTIONS.world
    && JSON.stringify(entry.matches || []) === JSON.stringify(MAIN_WORLD_BRIDGE_OPTIONS.matches)
    && JSON.stringify(entry.js || []) === JSON.stringify(MAIN_WORLD_BRIDGE_OPTIONS.js);
}

export async function ensureMainWorldBridgeRegistration(force = false) {
  if (extensionManifest.manifest_version !== 3) return false;
  const scripting = getScriptingApi();
  if (!scripting?.registerContentScripts) return false;
  let existing;
  try {
    existing = scripting.getRegisteredContentScripts
      ? await scripting.getRegisteredContentScripts({ ids: [MAIN_WORLD_BRIDGE_SCRIPT_ID] })
      : [];
  } catch (e) {
    existing = [];
  }
  const current = existing?.[0];
  if (!force && isMainWorldBridgeCurrent(current)) return true;
  try {
    if (current && scripting.unregisterContentScripts) {
      await scripting.unregisterContentScripts({ ids: [MAIN_WORLD_BRIDGE_SCRIPT_ID] });
    }
    await scripting.registerContentScripts([MAIN_WORLD_BRIDGE_OPTIONS]);
    return true;
  } catch (e) {
    const message = `${e?.message || e || ''}`;
    if (/already exists|duplicate/i.test(message) && scripting.unregisterContentScripts) {
      try {
        await scripting.unregisterContentScripts({ ids: [MAIN_WORLD_BRIDGE_SCRIPT_ID] });
        await scripting.registerContentScripts([MAIN_WORLD_BRIDGE_OPTIONS]);
        return true;
      } catch { /* NOP */ }
    }
    if (process.env.DEBUG) {
      console.warn('MV3 main-world bridge registration failed', e);
    }
    return false;
  }
}

function getUserScriptsEnableMessage() {
  const detailsPage = chrome.runtime?.id
    ? `chrome://extensions/?id=${chrome.runtime.id}`
    : 'chrome://extensions';
  return `Enable "Allow User Scripts" for Violentmonkey in ${detailsPage} (or opera://extensions), then reload this tab.`;
}

async function probeUserScriptsHealth() {
  const api = getUserScriptsApi();
  if (!api?.register) {
    return {
      state: extensionManifest.manifest_version === 3 && !IS_FIREFOX ? 'disabled' : 'unsupported',
      message: extensionManifest.manifest_version === 3 && !IS_FIREFOX
        ? getUserScriptsEnableMessage()
        : '',
      detail: 'userScripts.register missing',
    };
  }
  const id = `vm-health-check-${Date.now()}-${++userScriptSeq}`;
  try {
    await api.register([{
      id,
      matches: ['https://example.invalid/*'],
      js: [{ code: 'void 0;' }],
      runAt: 'document_start',
    }]);
    await api.unregister?.({ ids: [id] }).catch(noop);
    return {
      state: 'ok',
      message: '',
      detail: '',
    };
  } catch (err) {
    const detail = `${err?.message || err || ''}`.slice(0, 400);
    const state = USERSCRIPT_DISABLED_RE.test(detail) ? 'disabled' : 'error';
    return {
      state,
      message: state === 'disabled' ? getUserScriptsEnableMessage() : '',
      detail,
    };
  }
}

/**
 * @returns {Promise<{state: 'ok'|'disabled'|'unsupported'|'error'|'unknown', message: string, detail: string}>}
 */
export async function getUserScriptsHealth(force) {
  const now = Date.now();
  if (!force && now - userScriptsHealth.checkedAt < USERSCRIPT_HEALTH_TTL) {
    return userScriptsHealth;
  }
  userScriptsHealth = {
    ...await probeUserScriptsHealth(),
    checkedAt: now,
  };
  if (userScriptsHealth.state === 'disabled' && userScriptsHealth.message) {
    void pushAlert({
      code: 'mv3.userScriptsDisabled',
      severity: 'warn',
      message: userScriptsHealth.message,
      details: { detail: userScriptsHealth.detail },
      fingerprint: 'mv3.userScriptsDisabled',
    });
  }
  return userScriptsHealth;
}

/**
 * Executes code in MV3 via userScripts API when available (Chrome 135+).
 * Returns null when unavailable/unsupported so callers can fallback.
 */
async function executeUserScriptCode(tabId, options) {
  const api = getUserScriptsApi();
  if (!api?.execute || !options?.code) return null;
  const target = { tabId };
  const userScriptsWorld = normalizeWorldForUserScripts(options.world);
  if (options[kFrameId] != null) target.frameIds = [options[kFrameId]];
  if (options.allFrames) target.allFrames = true;
  try {
    const result = await api.execute({
      target,
      js: [{ code: options.code || '' }],
      ...userScriptsWorld && { world: userScriptsWorld },
      ...options[RUN_AT] === 'document_start' && { injectImmediately: true },
    });
    if (!result?.map) return [];
    const err = result.find(item => item?.error)?.error;
    if (err) throw new Error(err);
    return result.map(item => item.result);
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('userScripts.execute fallback to register/executeScript', e);
    }
    return null;
  }
}

function rememberRegisteredUserScript(tabId, id) {
  let ids = registeredUserScriptsByTab.get(tabId);
  if (!ids) {
    ids = new Set();
    registeredUserScriptsByTab.set(tabId, ids);
  }
  ids.add(id);
}

const isOneShotUserScriptId = id => (
  typeof id === 'string' && id.startsWith(USERSCRIPT_ONE_SHOT_ID_PREFIX)
);

/**
 * Cleans up one-shot userscript registrations that can outlive a service-worker restart.
 * Runs once per userscripts API instance by default.
 */
export async function cleanupStaleUserScriptsAtStartup(force) {
  const api = getUserScriptsApi();
  if (!api?.getScripts || !api?.unregister) return false;
  if (!force
  && staleUserScriptsCleanupApi === api
  && staleUserScriptsCleanupPromise) {
    return staleUserScriptsCleanupPromise;
  }
  staleUserScriptsCleanupApi = api;
  staleUserScriptsCleanupPromise = (async () => {
    try {
      const scripts = await api.getScripts();
      const staleIds = scripts
        ?.map(script => script?.id)
        .filter(isOneShotUserScriptId) || [];
      if (!staleIds[0]) return false;
      await api.unregister({ ids: staleIds });
      return true;
    } catch (e) {
      if (process.env.DEBUG) {
        console.warn('MV3 userscripts stale one-shot cleanup failed', e);
      }
      return false;
    }
  })();
  return staleUserScriptsCleanupPromise;
}

/**
 * Unregisters tracked userscript IDs for a tab. If `ids` is omitted, all tracked IDs are removed.
 */
export async function cleanupRegisteredUserScripts(tabId, ids) {
  const api = getUserScriptsApi();
  const tracked = registeredUserScriptsByTab.get(tabId);
  if (!api?.unregister || !tracked?.size) return;
  const selected = ids?.filter(id => tracked.has(id));
  const unregisterIds = selected || [...tracked];
  if (!unregisterIds[0]) return;
  unregisterIds.forEach(id => tracked.delete(id));
  if (!tracked.size) registeredUserScriptsByTab.delete(tabId);
  try {
    await api.unregister({ ids: unregisterIds });
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('userScripts.unregister cleanup failed', e);
    }
  }
}

function makeUserScriptMatch(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  const protocol = parsed.protocol.slice(0, -1);
  if (!/^(https?|file|ftp)$/.test(protocol)) return null;
  if (protocol === 'file') return 'file:///*';
  const path = parsed.pathname || '/';
  return `${parsed.protocol}//${parsed.host}${path}*`;
}

/**
 * Registers a short-lived userscript in MV3 runtimes and returns true on success.
 * Fallback caller should use executeScript when this returns false.
 */
export async function registerUserScriptOnce(tabId, options) {
  const api = getUserScriptsApi();
  if (!api?.register || !options?.code || options[kFrameId] > 0) return false;
  const userScriptsWorld = normalizeWorldForUserScripts(options.world);
  await cleanupStaleUserScriptsAtStartup();
  const tab = browser.tabs.get
    ? await browser.tabs.get(tabId).catch(noop)
    : null;
  const match = makeUserScriptMatch(getTabUrl(tab || {}));
  if (!match) return false;
  const id = `${USERSCRIPT_ONE_SHOT_ID_PREFIX}${Date.now()}-${tabId}-${++userScriptSeq}`;
  try {
    await api.register([{
      id,
      matches: [match],
      js: [{ code: options.code || '' }],
      runAt: options[RUN_AT] || 'document_start',
      allFrames: !!options.allFrames,
      ...userScriptsWorld && { world: userScriptsWorld },
    }]);
    rememberRegisteredUserScript(tabId, id);
    const timer = setTimeout(() => {
      cleanupRegisteredUserScripts(tabId, [id]);
    }, USERSCRIPT_UNREGISTER_DELAY);
    timer?.unref?.();
    return true;
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('userScripts.register fallback to executeScript', e);
    }
    return false;
  }
}

/**
 * Registers a one-shot ISOLATED-world content script via scripting.registerContentScripts.
 * Returns true on success.
 */
export async function registerIsolatedContentScriptOnce(tabId, options) {
  const scripting = getScriptingApi();
  if (!scripting?.registerContentScripts || !options?.code) return false;
  const tab = browser.tabs.get
    ? await browser.tabs.get(tabId).catch(noop)
    : null;
  const match = makeUserScriptMatch(getTabUrl(tab || {}));
  if (!match) return false;
  const id = `${USERSCRIPT_ONE_SHOT_ID_PREFIX}iso-${Date.now()}-${tabId}-${++userScriptSeq}`;
  try {
    await scripting.registerContentScripts([{
      id,
      matches: [match],
      js: [{ code: options.code || '' }],
      runAt: options[RUN_AT] || 'document_end',
      allFrames: !!options.allFrames,
      persistAcrossSessions: false,
    }]);
    rememberRegisteredUserScript(tabId, id);
    const timer = setTimeout(() => {
      cleanupRegisteredUserScripts(tabId, [id]);
    }, USERSCRIPT_UNREGISTER_DELAY);
    timer?.unref?.();
    return true;
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('registerContentScripts ISOLATED fallback failed', e);
    }
    return false;
  }
}

/**
 * Registers a one-shot MAIN-world content script via scripting.registerContentScripts.
 * Useful for CSP eval fallbacks that must plant data on the real page window.
 */
export async function registerMainWorldContentScriptOnce(tabId, options) {
  const scripting = getScriptingApi();
  if (!scripting?.registerContentScripts || !options?.code) return false;
  const tab = browser.tabs.get
    ? await browser.tabs.get(tabId).catch(noop)
    : null;
  const match = makeUserScriptMatch(getTabUrl(tab || {}));
  if (!match) return false;
  const id = `${USERSCRIPT_ONE_SHOT_ID_PREFIX}main-${Date.now()}-${tabId}-${++userScriptSeq}`;
  try {
    await scripting.registerContentScripts([{
      id,
      matches: [match],
      js: [{ code: options.code || '' }],
      runAt: options[RUN_AT] || 'document_end',
      allFrames: !!options.allFrames,
      world: 'MAIN',
      persistAcrossSessions: false,
    }]);
    rememberRegisteredUserScript(tabId, id);
    const timer = setTimeout(() => {
      cleanupRegisteredUserScripts(tabId, [id]);
    }, USERSCRIPT_UNREGISTER_DELAY);
    timer?.unref?.();
    return true;
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('registerContentScripts MAIN-world fallback failed', e);
    }
    return false;
  }
}

function normalizeWorldForUserScripts(world) {
  // userScripts APIs run in USER_SCRIPT by default; only MAIN needs explicit opt-in.
  return world === 'MAIN' ? 'MAIN' : '';
}

/**
 * @param {string} [route] without #
 * @param {VMMessageSender} [src]
 */
export async function openDashboard(route, src) {
  const url = extensionOptionsPage + (route ? '#' + route : '');
  for (const tab of await browser.tabs.query({ url: extensionOptionsPage })) {
    const tabUrl = tab.url;
    // query() can't handle #hash so it returns tabs both with #hash and without it
    if (tabUrl === url || !route && tabUrl === url + ROUTE_SCRIPTS) {
      browserWindows?.update(tab[kWindowId], { focused: true });
      return browser.tabs.update(tab.id, { active: true });
    }
  }
  return commands.TabOpen({ url }, src);
}

/** Reloads the active tab if script matches the URL */
export async function reloadTabForScript(script) {
  const { url, id } = await getActiveTab();
  if (injectableRe.test(url) && testScript(url, script)) {
    return browser.tabs.reload(id);
  }
}

if (extensionManifest.manifest_version === 3) {
  void cleanupStaleUserScriptsAtStartup();
  void getUserScriptsHealth(true);
  void ensureMainWorldBridgeRegistration();
  // Enable chrome.runtime.sendMessage in USER_SCRIPT world for inline GM API stubs.
  // Required for the ContentEvalBlocked fallback path where scripts run in USER_SCRIPT world
  // with self-invoked code that routes GM.xmlHttpRequest through background messaging.
  getUserScriptsApi()?.configureWorld?.({ messaging: true })?.catch?.(() => {});
  browser.runtime.onInstalled?.addListener(() => {
    void ensureMainWorldBridgeRegistration(true);
    getUserScriptsApi()?.configureWorld?.({ messaging: true })?.catch?.(() => {});
  });
  browser.runtime.onStartup?.addListener(() => {
    void ensureMainWorldBridgeRegistration();
    getUserScriptsApi()?.configureWorld?.({ messaging: true })?.catch?.(() => {});
  });
}

/**
 * Handles GM API calls proxied from USER_SCRIPT world via chrome.runtime.sendMessage.
 * Only active in MV3 where USER_SCRIPT world messaging is configured.
 * Supports the inline GM API stubs injected by injectContentRealm for strict-CSP pages.
 */
if (extensionManifest.manifest_version === 3) {
  chrome.runtime.onUserScriptMessage?.addListener((message, sender, sendResponse) => {
    if (!message?.__vmGM) return; // not our message
    if (message.fn === 'xhr') {
      handleUserScriptGmXhr(message.opts || {}, sender, sendResponse);
      return true; // keep channel open for async response
    }
  });
}

async function handleUserScriptGmXhr(opts, sender, sendResponse) {
  const { method = 'GET', url, headers = {}, data, timeout = 0, responseType = '' } = opts;
  if (!url) {
    sendResponse({ __vmError: { status: 0, statusText: 'Missing URL', responseText: '', finalUrl: '', readyState: 4 } });
    return;
  }
  const controller = new AbortController();
  let timeoutId;
  if (timeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }
  try {
    // Build headers; inject Referer from the sender tab if not already provided by the script.
    const mergedHeaders = { ...headers };
    const refererKey = Object.keys(mergedHeaders).find(k => k.toLowerCase() === 'referer');
    if (!refererKey && sender?.url) {
      mergedHeaders['Referer'] = sender.url;
    }
    const fetchOpts = {
      method,
      headers: new Headers(mergedHeaders),
      signal: controller.signal,
    };
    if (data && method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = data;
    }
    const response = await fetch(url, fetchOpts);
    const responseText = await response.text();
    if (timeoutId) clearTimeout(timeoutId);
    let responseJSON = null;
    if (!responseType || responseType === 'json') {
      try { responseJSON = JSON.parse(responseText); } catch (e) { /* not JSON */ }
    }
    logBackgroundAction('userscript.gm.xhr.response', {
      url,
      method,
      status: response.status,
      finalUrl: response.url,
      referer: mergedHeaders['Referer'] || '',
      isJson: responseJSON !== null,
      responseSnippet: responseText.slice(0, 500),
    }, 'debug');
    sendResponse({
      finalUrl: response.url,
      readyState: 4,
      status: response.status,
      statusText: response.statusText,
      responseText,
      response: responseType === 'json' ? responseJSON : responseText,
      responseJSON,
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      sendResponse({ __vmTimeout: { status: 0, statusText: 'Timeout', responseText: '', finalUrl: url, readyState: 4 } });
    } else {
      sendResponse({ __vmError: { status: 0, statusText: String(err?.message || err), responseText: '', finalUrl: url, readyState: 4 } });
    }
  }
}

