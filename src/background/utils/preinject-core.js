import { noop, sendTabCmd } from '@/common';
import { executeScript, INJECTED_DATA_ID } from '@/common/browser-scripts-api';
import initCache from '@/common/cache';
import {
  __CODE, BLACKLIST, CACHE_KEYS, GLOB_ALL, kDownloadMode, kMainFrame, kSubFrame, REQ_KEYS, UNWRAP,
  VALUE_IDS, XHR_COOKIE_RE,
} from '@/common/consts';
import { forEachEntry, objectSet } from '@/common/object';
import { kGmDownloadViaApi, kPageMenuCommands } from '@/common/options-defaults';
import { revokeBlobRules } from './dnr';
import { clearNotifications } from './notifications';
import { getOption, hookOptionsInit } from './options';
import { addMenuConfig } from './page-menu-commands';
import { onPermissionChanged, permissionDownloads } from './permissions';
import { normalizeRealm, prepare, prepareXhrBlob } from './preinject-prepare';
import { clearRequestsByTabId } from './requests';
import { kSetCookie } from './requests-core';
import { flushSession, skippedTabs } from './session-data';
import { S_CACHE_PRE, S_CODE_PRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE_PRE } from './storage';
import { clearStorageCache } from './storage-cache';
import { forEachTab, tabsOnRemoved } from './tabs';
import { clearValueOpener } from './values';

export let isApplied;
export let injectInto;
export let downloadMode;
export let ffCsp;
export let ffInject;
export let xhrInject = false; // must be initialized for proper comparison when toggling
let xhrInjectKey;

const API_HEADERS_RECEIVED = browser.webRequest.onHeadersReceived;
const API_XHR = __.MV3 ? browser.webRequest.onBeforeRequest : API_HEADERS_RECEIVED;
export const makeXhrHeader = (key, blobUrl) => ({
  [key]: kSetCookie,
  value: `${xhrInjectKey}=${blobUrl.split('/').pop()}; SameSite=Lax`,
});
const API_CONFIG = {
  urls: [GLOB_ALL], // `*` scheme matches only http and https
  types: [kMainFrame, kSubFrame],
};
const API_EXTRA = [
  !__.MV3 && 'blocking', // used for xhrInject and to make Firefox fire the event before GetInjected
  kResponseHeaders,
  browser.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS,
].filter(Boolean);
const findCspHeader = h => h.name.toLowerCase() === 'content-security-policy';
const CSP_RE = /(?:^|[;,])\s*(?:script-src(-elem)?|(d)efault-src)(\s+[^;,]+)/g;
const NONCE_RE = /'nonce-([-+/=\w]+)'/;
const UNSAFE_INLINE = "'unsafe-inline'";
export const CSAPI_REG = 'csReg';
export const contentScriptsAPI = !__.MV3 && browser.contentScripts;
export const cache = initCache({
  lifetime: 5 * 60e3,
  onDispose(val) {
    // In Chrome the user can disable this API at any time
    if (__.MV3 ? chrome.userScripts : contentScriptsAPI) unregisterScript(val);
    cache.del(val[MORE]);
  },
});
export const propsToClear = {
  [S_CACHE_PRE]: CACHE_KEYS,
  [S_CODE_PRE]: true,
  [S_REQUIRE_PRE]: REQ_KEYS,
  [S_SCRIPT_PRE]: true,
  [S_VALUE_PRE]: VALUE_IDS,
};
export const expose = {};
const resolveDataCodeStr = `(${(global, key, data) => {
  if (__.DEBUG) console.info('Injected reg', global[key], global[__.INIT_FUNC_NAME], data);
  // Using `global` and `key` as parameters because global consts aren't accessible here
  if (typeof global[key] === 'function') {
    global[key](data);
  } else if (global[__.INIT_FUNC_NAME] !== 1) { // eslint-disable-line no-undef
    // Ran earlier than the main content script so let's just drop the payload
    global[key] = data;
  }
}})`;
export const getKey = (url, isTop) => (
  isTop ? url : `-${url}`
);
/** @param {chrome.webRequest.WebRequestDetails} info */
export const isTopFrame = info => info.frameType === 'outermost_frame' || !info[kFrameId];

const OPT_HANDLERS = {
  [BLACKLIST]: cache.destroy,
  defaultInjectInto(value) {
    value = normalizeRealm(value);
    cache.destroy();
    if (injectInto) { // already initialized, so we should update the listener
      if (value === CONTENT) {
        API_HEADERS_RECEIVED.removeListener(onHeadersReceived);
      } else if (isApplied && IS_FIREFOX && !xhrInject) {
        API_HEADERS_RECEIVED.addListener(onHeadersReceived, API_CONFIG, API_EXTRA);
      }
    }
    injectInto = value;
  },
  [kPageMenuCommands](enable) {
    cache.some(val => {
      const inject = val[INJECT];
      if (inject && kUseMenu in inject) {
        inject[kUseMenu] = enable;
        if (__.MV3 ? chrome.userScripts : contentScriptsAPI) unregisterScript(val);
        // TODO: maybe re-register automatically?
      }
    });
  },
  /** WARNING! toggleXhrInject should precede togglePreinject as it sets xhrInject variable */
  xhrInject: toggleXhrInject,
  [IS_APPLIED]: togglePreinject,
  [EXPOSE](value) {
    value::forEachEntry(([site, isExposed]) => {
      expose[decodeURIComponent(site)] = isExposed;
    });
  },
  ffCsp: value => {
    if (ffCsp != null) cache.destroy();
    ffCsp = value;
  },
  [kGmDownloadViaApi]: updateDownloadMode,
};
if (contentScriptsAPI) OPT_HANDLERS.ffInject = toggleFastFirefoxInject;
onPermissionChanged.add(() => updateDownloadMode(getOption(kGmDownloadViaApi)));
hookOptionsInit(onOptionChanged);

function onOptionChanged(changes) {
  // DANGER! Must initialize in the specified order
  for (const key in OPT_HANDLERS) {
    if (key in changes) OPT_HANDLERS[key](changes[key]);
  }
  for (const key in changes) {
    if (key.includes('.')) { // used by `expose.url`
      onOptionChanged(objectSet({}, key, changes[key]));
    }
  }
}

function toggleXhrInject(enable) {
  if (enable) enable = injectInto !== CONTENT;
  if (xhrInject === enable) return;
  xhrInject = enable;
  xhrInjectKey ??= extensionRoot.match(XHR_COOKIE_RE)[1];
  cache.destroy();
  API_XHR.removeListener(onHeadersReceived);
  if (enable) {
    API_XHR.addListener(onHeadersReceived, API_CONFIG, __.MV3 ? undefined : API_EXTRA);
  } else if (__.MV3) {
    revokeBlobRules();
  }
}

function togglePreinject(enable) {
  isApplied = enable;
  // Using onSendHeaders because onHeadersReceived in Firefox fires *after* content scripts.
  // And even in Chrome a site may be so fast that preinject on onHeadersReceived won't be useful.
  const onOff = `${enable ? 'add' : 'remove'}Listener`;
  const config = enable ? API_CONFIG : undefined;
  browser.webRequest.onSendHeaders[onOff](onSendHeaders, config);
  if (!isApplied /* remove the listener */
  || IS_FIREFOX && !xhrInject && injectInto !== CONTENT /* add 'nonce' detector */) {
    API_HEADERS_RECEIVED[onOff](onHeadersReceived, config, config && API_EXTRA);
  }
  tabsOnRemoved[onOff](onTabRemoved);
  browser.tabs.onReplaced[onOff](onTabReplaced);
  if (!enable) {
    cache.destroy();
    clearFrameData();
    clearStorageCache();
  }
}

function toggleFastFirefoxInject(enable) {
  ffInject = enable;
  if (!enable) {
    cache.some(v => { unregisterScript(v); /* must return falsy! */ });
  } else if (!xhrInject) {
    cache.destroy(); // nuking the cache so that CSAPI_REG is created for subsequent injections
  }
}

/** @param {chrome.webRequest.WebRequestDetails} info */
function onSendHeaders(info) {
  const { url, tabId } = info;
  const isTop = isTopFrame(info);
  const key = getKey(url, isTop);
  if (!cache.has(key) && !skippedTabs[tabId]) {
    prepare(key, url, isTop);
  }
}

/** @param {chrome.webRequest.WebRequestDetails} info */
function onHeadersReceived(info) {
  const key = getKey(info.url, isTopFrame(info));
  const bag = cache.get(key);
  // The INJECT data is normally already in cache if code and values aren't huge
  if (bag && !bag[FORCE_CONTENT] && bag[INJECT]?.[SCRIPTS] && !skippedTabs[info.tabId]) {
    const res = xhrInject && prepareXhrBlob(info, bag);
    return IS_FIREFOX && info.url.startsWith('https:') && detectStrictCsp(info, bag, res)
      || res;
  }
}

export function injectContentRealm(toContent, tabId, frameId) {
  for (const [id, dataKey] of toContent) {
    const scr = cache.get(S_SCRIPT_PRE + id); // TODO: recreate if expired?
    if (!scr || scr.key.data !== dataKey) continue;
    const code = scr[__CODE].join('');
    executeScript(tabId, code, `document_${scr[RUN_AT]}`.replace('body', 'start'), frameId)
      .then(scr.meta[UNWRAP] && (() => sendTabCmd(tabId, 'Run', id, { [kFrameId]: frameId })));
  }
}

// TODO: rework the whole thing to register scripts individually with real `matches`
// (this will also allow proper handling of @noframes)
export function registerScriptData(inject, url) {
  addMenuConfig(inject);
  (/**@type{VMInjection}*/inject).info.gmi[kDownloadMode] = downloadMode;
  for (const scr of inject[SCRIPTS]) {
    scr.code = scr[__CODE];
  }
  /** @type {chrome.userScripts.RegisteredUserScript | browser.contentScripts.RegisteredContentScriptOptions} */
  inject = {
    js: [{
      code: `${resolveDataCodeStr}(this,"${VIOLENTMONKEY}",${JSON.stringify(inject)})`,
    }],
    matches: [url.split('#', 1)[0].replace(/\*/g, '\\$&')], // escape `*` in the URL itself
    [RUN_AT]: 'document_start',
  };
  if (__.MV3) {
    inject.id = INJECTED_DATA_ID + url;
    inject = [inject];
    chrome.userScripts.update(inject).catch(noop);
  }
  return (__.MV3 ? chrome.userScripts : contentScriptsAPI).register(inject).catch(noop);
}

/** @param {VMInjection.Bag} bag */
export function unregisterScript(bag) {
  const reg = bag[CSAPI_REG];
  if (reg) {
    delete bag[CSAPI_REG];
    return reg.then(r => __.MV3
      ? chrome.userScripts.unregister({ ids: [INJECTED_DATA_ID + bag.url] }).catch(noop)
      : r.unregister(),
    );
  }
}

/**
 * @param {chrome.webRequest.WebRequestDetails} info
 * @param {VMInjection.Bag} bag
 * @param {browser.webRequest.BlockingResponse} response
 */
function detectStrictCsp(info, bag, response) {
  const headers = info[kResponseHeaders];
  const h = headers.find(findCspHeader);
  if (!h) return;
  let tmp = '';
  let m, scriptSrc, scriptElemSrc, defaultSrc;
  while ((m = CSP_RE.exec(h.value))) {
    tmp += m[2] ? (defaultSrc = m[3]) : m[1] ? (scriptElemSrc = m[3]) : (scriptSrc = m[3]);
  }
  if (!tmp) return;
  let nonce = tmp.match(NONCE_RE);
  if (nonce) {
    nonce = nonce[1];
  } else if (
    scriptSrc && !scriptSrc.includes(UNSAFE_INLINE) ||
    scriptElemSrc && !scriptElemSrc.includes(UNSAFE_INLINE) ||
    !scriptSrc && !scriptElemSrc && defaultSrc && !defaultSrc.includes(UNSAFE_INLINE)
  ) {
    if (ffCsp) {
      nonce = crypto.randomUUID();
      h.value = h.value.replace(CSP_RE, `$& 'nonce-${nonce}'`);
      response ||= { [kResponseHeaders]: headers };
    } else {
      bag[FORCE_CONTENT] = bag[INJECT][FORCE_CONTENT] = true;
    }
  } else {
    return;
  }
  if (nonce) bag[INJECT].nonce = nonce;
  if (contentScriptsAPI && unregisterScript(bag)) {
    bag.csStop?.(); // resolving a potential deadlock in CS API on a fast redirect
    return Promise.race([
      bag[CSAPI_REG] = registerScriptData(bag[INJECT], info.url),
      new Promise(resolve => (bag.csStop = resolve)),
    ]).then(() => (bag.csStop = null, response));
  }
  return response;
}

function onTabRemoved(id /* , info */) {
  clearFrameData(id, 0, true);
  delete skippedTabs[id];
  if (__.MV3) flushSession(SKIP_SCRIPTS, skippedTabs);
}

function onTabReplaced(addedId, removedId) {
  onTabRemoved(removedId);
}

function clearFrameData(tabId, frameId, tabRemoved) {
  clearRequestsByTabId(tabId, frameId);
  clearValueOpener(tabId, frameId);
  clearNotifications(tabId, frameId, tabRemoved);
}

function updateDownloadMode(val) {
  val = val && permissionDownloads ? 'browser' : 'native';
  if (downloadMode !== val) {
    if (downloadMode != null) {
      forEachTab(sendTabCmd, 'SetGMI', { [kDownloadMode]: val });
    }
    downloadMode = val;
  }
}
