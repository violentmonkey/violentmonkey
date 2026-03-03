import {
  getActiveTab, getScriptName, getScriptPrettyUrl, getUniqId, sendTabCmd,
} from '@/common';
import {
  __CODE, TL_AWAIT, UNWRAP, XHR_COOKIE_RE,
  BLACKLIST, HOMEPAGE_URL, KNOWN_INJECT_INTO, META_STR, METABLOCK_RE, NEWLINE_END_RE,
} from '@/common/consts';
import initCache from '@/common/cache';
import {
  deepCopy, forEachEntry, forEachValue, mapEntry, objectPick, objectSet,
} from '@/common/object';
import { CACHE_KEYS, getScriptsByURL, kTryVacuuming, PROMISE, REQ_KEYS, VALUE_IDS } from './db';
import { setBadge } from './icon';
import { addOwnCommands, addPublicCommands } from './init';
import { clearNotifications } from './notifications';
import { hookOptionsInit } from './options';
import { popupTabs } from './popup-tracker';
import { analyzeCspForInject } from './preinject-csp';
import { logBackgroundAction, logBackgroundError } from './diagnostics';
import { clearRequestsByTabId, reifyRequests } from './requests';
import { kSetCookie } from './requests-core';
import { updateVisitedTime } from './script';
import {
  S_CACHE, S_CACHE_PRE, S_CODE, S_CODE_PRE, S_REQUIRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE,
  S_VALUE_PRE,
} from './storage';
import { clearStorageCache, onStorageChanged } from './storage-cache';
import {
  executeScriptInTab,
  getFrameDocId,
  getFrameDocIdAsObj,
  injectableRe,
  tabsOnUpdated,
  tabsOnRemoved,
  registerIsolatedContentScriptOnce,
  registerMainWorldContentScriptOnce,
} from './tabs';
import { addValueOpener, clearValueOpener, reifyValueOpener } from './values';
import { ua } from './ua';

let isApplied;
let injectInto;
let ffInject;
let xhrInject = false; // must be initialized for proper comparison when toggling
let xhrInjectKey;
const IS_MV3 = extensionManifest.manifest_version === 3;
const CAN_BLOCK_WEBREQUEST = !IS_MV3;

const sessionId = getUniqId();
const API_HEADERS_RECEIVED = browser.webRequest.onHeadersReceived;
const API_CONFIG = {
  urls: ['*://*/*'], // `*` scheme matches only http and https
  types: ['main_frame', 'sub_frame'],
};
const API_EXTRA = [
  CAN_BLOCK_WEBREQUEST && 'blocking', // used for xhrInject and to make Firefox fire the event before GetInjected
  kResponseHeaders,
  browser.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS,
].filter(Boolean);
let warnedHeadersReceivedCompat;
const findCspHeader = h => h.name.toLowerCase() === 'content-security-policy';
const SKIP_COMMENTS_RE = /^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*[\r\n]+|\s+)*/u;
/** Not using a combined regex to check for the chars to avoid catastrophic backtracking */
const isUnsafeConcat = s => (s = s.charCodeAt(s.match(SKIP_COMMENTS_RE)[0].length)) === 45/*"-"*/
  || s === 43/*"+"*/
  || s === 91/*"["*/
  || s === 40/*"("*/;
/** These bags are reused in cache to reduce memory usage,
 * CACHE_KEYS is for removeStaleCacheEntry */
const BAG_NOOP = { [INJECT]: {}, [CACHE_KEYS]: [] };
const BAG_NOOP_EXPOSE = { ...BAG_NOOP, [INJECT]: { [EXPOSE]: true, [kSessionId]: sessionId } };
const CSAPI_REG = 'csReg';
const contentScriptsAPI = browser.contentScripts;
const cache = initCache({
  lifetime: 5 * 60e3,
  onDispose(val) {
    if (IS_FIREFOX) unregisterScriptFF(val);
    cache.del(val[MORE]);
  },
});
// KEY_XXX for hooked options
const GRANT_NONE_VARS = '{GM,GM_info}';
const META_KEYS_TO_ENSURE = [
  'description',
  'name',
  'namespace',
  [RUN_AT],
  'version',
];
const META_KEYS_TO_ENSURE_FROM = [
  [HOMEPAGE_URL, 'homepage'],
];
const META_KEYS_TO_PLURALIZE_RE = /^(?:(m|excludeM)atch|(ex|in)clude)$/;
const pluralizeMetaKey = (s, consonant) => s + (consonant ? 'es' : 's');
const pluralizeMeta = key => key.replace(META_KEYS_TO_PLURALIZE_RE, pluralizeMetaKey);
const propsToClear = {
  [S_CACHE_PRE]: CACHE_KEYS,
  [S_CODE_PRE]: true,
  [S_REQUIRE_PRE]: REQ_KEYS,
  [S_SCRIPT_PRE]: true,
  [S_VALUE_PRE]: VALUE_IDS,
};
const expose = {};
const resolveDataCodeStr = `(${(global, data) => {
  if (global.vmResolve) global.vmResolve(data); // `window` is a const which is inaccessible here
  else global.vmData = data; // Ran earlier than the main content script so just drop the payload
}})`;
const getKey = (url, isTop) => (
  isTop ? url : `-${url}`
);
const getBaseUrl = url => url?.split('#', 1)[0] || url;
const getCspHintKey = (tabId, url) => `${tabId}\n${getBaseUrl(url)}`;
const CSP_HINT_WAIT_MS = 75;
const SCRIPT_ENTERED_HOOK = '__VM_SCRIPT_ENTERED__';
const cspHints = Object.create(null);
const cspHintWaiters = Object.create(null);
const normalizeRealm = val => (
  KNOWN_INJECT_INTO[val] ? val : injectInto || AUTO
);
const normalizeScriptRealm = (custom, meta) => (
  normalizeRealm(custom[INJECT_INTO] || meta[INJECT_INTO])
);
const isContentRealm = (val, force) => (
  val === CONTENT || val === AUTO && force
);
/** @param {chrome.webRequest.WebRequestHeadersDetails | chrome.webRequest.WebResponseHeadersDetails} info */
const isTopFrame = info => info.frameType === 'outermost_frame' || !info[kFrameId];

const skippedTabs = {};
export const reloadAndSkipScripts = async tab => {
  if (!tab) tab = await getActiveTab();
  const tabId = tab.id;
  const bag = cache.get(getKey(tab.url, true));
  const reg = IS_FIREFOX && bag && unregisterScriptFF(bag);
  skippedTabs[tabId] = 1;
  if (reg) await reg;
  clearFrameData(tabId);
  await browser.tabs.reload(tabId);
};

function toggleHeadersReceivedListener(onOff, config) {
  if (onOff === 'removeListener') {
    API_HEADERS_RECEIVED.removeListener(onHeadersReceived);
    return;
  }
  try {
    API_HEADERS_RECEIVED.addListener(onHeadersReceived, config, API_EXTRA);
  } catch (e1) {
    try {
      // Fallback for runtimes that don't support extra options in this event mode.
      API_HEADERS_RECEIVED.addListener(onHeadersReceived, config);
    } catch (e2) {
      if (process.env.DEBUG && !warnedHeadersReceivedCompat) {
        warnedHeadersReceivedCompat = true;
        console.warn('onHeadersReceived listener registration failed in this runtime.', e2 || e1);
      }
    }
  }
}

const OPT_HANDLERS = {
  [BLACKLIST]: cache.destroy,
  defaultInjectInto(value) {
    value = normalizeRealm(value);
    cache.destroy();
    if (injectInto) { // already initialized, so we should update the listener
      toggleHeadersReceivedListener('removeListener');
      if (isApplied && (IS_MV3 || IS_FIREFOX && !xhrInject && value !== CONTENT)) {
        toggleHeadersReceivedListener('addListener', API_CONFIG);
      }
    }
    injectInto = value;
  },
  /** WARNING! toggleXhrInject should precede togglePreinject as it sets xhrInject variable */
  xhrInject: toggleXhrInject,
  [IS_APPLIED]: togglePreinject,
  [EXPOSE](value) {
    value::forEachEntry(([site, isExposed]) => {
      expose[decodeURIComponent(site)] = isExposed;
    });
  },
};
if (contentScriptsAPI) OPT_HANDLERS.ffInject = toggleFastFirefoxInject;

addOwnCommands({
  [SKIP_SCRIPTS]: reloadAndSkipScripts,
});

addPublicCommands({
  /** @return {Promise<VMInjection>} */
  async GetInjected(payload, src) {
    let {
      url,
      [FORCE_CONTENT]: forceContent,
      done,
    } = payload || {};
    const { tab, [kFrameId]: frameId, [kTop]: isTop } = src;
    const frameDoc = getFrameDocId(isTop, src[kDocumentId], frameId);
    const tabId = tab.id;
    if (!url) url = src.url || tab.url;
    clearFrameData(tabId, frameDoc);
    let skip = skippedTabs[tabId];
    if (skip > 0) { // first time loading the tab after skipScripts was invoked
      if (isTop) skippedTabs[tabId] = -1; // keeping a phantom for future iframes in this page
      if (popupTabs[tabId]) sendPopupShown(tabId, frameDoc);
      return { [INJECT_INTO]: SKIP_SCRIPTS };
    }
    if (skip) delete skippedTabs[tabId]; // deleting the phantom as we're in a new page
    const bagKey = getKey(url, isTop);
    const bagP = cache.get(bagKey) || prepare(bagKey, url, isTop);
    const bag = bagP[INJECT] ? bagP : await bagP[PROMISE];
    /** @type {VMInjection} */
    const inject = bag[INJECT];
    if (IS_MV3 && tabId >= 0) {
      const cspHintKey = getCspHintKey(tabId, url);
      const cspHint = cspHints[cspHintKey];
      if (cspHint) {
        applyCspResultToBag(cspHint, bag, url);
      } else if (inject[PAGE] && !bag[FORCE_CONTENT]) {
        logBackgroundAction('preinject.cspHint.pending', {
          tabId,
          url: getBaseUrl(url),
        }, 'debug');
        // Block GetInjected for up to CSP_HINT_WAIT_MS so triageRealms sees
        // the correct realm (forceContent / nonce) before scripts are dispatched.
        const hint = await waitForCspHint(cspHintKey);
        if (hint) {
          applyCspResultToBag(hint, bag, url);
          logBackgroundAction('preinject.cspHint.applied', {
            tabId,
            url: getBaseUrl(url),
            forceContent: !!hint.forceContent,
            nonce: !!hint.nonce,
          }, 'debug');
        }
      }
    }
    const scripts = inject[SCRIPTS];
    if (scripts) {
      triageRealms(scripts, bag[FORCE_CONTENT] || forceContent, tabId, frameId, bag);
      addValueOpener(scripts, tabId, frameDoc);
      if (isTop < 2/* skip prerendered pages*/ && scripts.length) {
        updateVisitedTime(scripts);
      }
    }
    if (popupTabs[tabId]) {
      sendPopupShown(tabId, frameDoc);
    }
    return isApplied
      ? !done && inject
      : { [INJECT_INTO]: 'off', ...inject };
  },
  async InjectionFeedback(payload, src) {
    let {
      [FORCE_CONTENT]: forceContent,
      [CONTENT]: items,
      [MORE]: moreKey,
      url,
    } = payload || {};
    if (!isApplied) return; // the user disabled injection right after page started loading
    const { tab, [kFrameId]: frameId } = src;
    const isTop = src[kTop];
    const tabId = tab.id;
    if (IS_MV3 && forceContent && tabId >= 0) {
      const hintedUrl = url || src.url || tab.url;
      if (hintedUrl) {
        const key = getCspHintKey(tabId, hintedUrl);
        publishCspHint(key, { forceContent: true }, 'feedback');
        const bag = cache.get(getKey(hintedUrl, true));
        if (bag) applyCspResultToBag(cspHints[key], bag, hintedUrl);
      }
    }
    injectContentRealm(items, tabId, frameId);
    if (!moreKey) return;
    if (!url) url = src.url || tab.url;
    const env = cache.get(moreKey)
      || cache.put(moreKey, getScriptsByURL(url, isTop))
      || { [SCRIPTS]: [] }; // scripts got removed or the url got blacklisted after GetInjected
    const envCache = (env[PROMISE] ? await env[PROMISE] : env)[S_CACHE];
    const scripts = prepareScripts(env);
    triageRealms(scripts, forceContent, tabId, frameId);
    addValueOpener(scripts, tabId, getFrameDocId(isTop, src[kDocumentId], frameId));
    if (isTop < 2/* skip prerendered pages*/ && scripts.length) {
      updateVisitedTime(scripts);
    }
    return {
      [SCRIPTS]: scripts,
      [S_CACHE]: envCache,
    };
  },
  Run(payload, src) {
    const { [IDS]: ids, reset } = payload || {};
    const {
      [kDocumentId]: docId,
      [kTop]: isTop,
      tab: { id: tabId },
    } = src;
    const hasIds = +ids?.[0];
    setBadge(ids, reset, src);
    if (isTop === 3) {
      if (hasIds) {
        reifyValueOpener(ids, docId);
        updateVisitedTime(ids, true);
      }
      reifyRequests(tabId, docId);
      clearNotifications(tabId);
    }
    if (reset === 'bfcache' && hasIds) {
      addValueOpener(ids, tabId, getFrameDocId(isTop, docId, src[kFrameId]));
    }
  },
});

hookOptionsInit(onOptionChanged);

onStorageChanged((keys, data) => {
  const toClear = [];
  for (const key of keys) {
    const i = key.indexOf(':') + 1;
    const prefix = key.slice(0, i);
    const id = key.slice(i);
    /* TODO: only delete the script's entry if no impactful @key is changed in metablock?
       Might be beneficial for local file tracking. */
    if (propsToClear[prefix] === true) {
      cache.destroy();
      return;
    }
    let script, values;
    // Patching cached script's values
    if (prefix === S_VALUE_PRE) {
      values = data?.[key];
      if ((script = cache.get(S_SCRIPT_PRE + id))) {
        script[VALUES] = values = deepCopy(values) || script[VALUES] && {};
        // {} enables tracking in addValueOpener
      }
    }
    // Removing values/require/resource in injection bags
    if (prefix) {
      toClear.push([prefix, id, values]);
    }
  }
  if (toClear.length) cache.some(removeStaleCacheEntry, toClear);
});

/** @this {string[][]} changed storage keys, already split as [prefix,id] */
function removeStaleCacheEntry(val, key) {
  if (!val[CACHE_KEYS]) return;
  for (const [prefix, id, newData] of this) {
    const prop = propsToClear[prefix];
    if (val[prop]?.includes(+id || id)) {
      if (prefix === S_REQUIRE_PRE) {
        val.depsMap[id].forEach(scriptId => cache.del(S_SCRIPT_PRE + scriptId));
      } else if (prefix === S_VALUE_PRE) {
        if (val[S_VALUE]) val[S_VALUE][id] = newData; // envDelayed
        setBaggedScriptValues(val, +id, newData);
        if (!val[CSAPI_REG]) continue;
      }
      cache.del(key); // TODO: try to patch the cache in-place?
    }
  }
}

function setBaggedScriptValues(bag, id, val) {
  for (const /** @type {VMInjection.Script} */scr of (bag[INJECT] || bag)[SCRIPTS]) {
    if (scr.id === id) {
      scr[VALUES] = val || scr[VALUES] && {};
      // {} enables tracking in addValueOpener
      return true;
    }
  }
}

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
  if (enable && !CAN_BLOCK_WEBREQUEST) {
    if (process.env.DEBUG) {
      console.warn('MV3: xhrInject requires webRequest blocking and is disabled.');
    }
    enable = false;
  }
  if (enable) enable = injectInto !== CONTENT;
  if (xhrInject === enable) return;
  xhrInject = enable;
  xhrInjectKey ??= extensionRoot.match(XHR_COOKIE_RE)[1];
  cache.destroy();
  toggleHeadersReceivedListener('removeListener');
  if (enable) {
    toggleHeadersReceivedListener('addListener', API_CONFIG);
  }
}

function togglePreinject(enable) {
  isApplied = enable;
  const onOff = `${enable ? 'add' : 'remove'}Listener`;
  const config = enable ? API_CONFIG : undefined;
  // MV3 can't rely on blocking request hooks, so we prewarm via tab URL updates.
  if (IS_MV3) {
    if (enable) {
      try {
        tabsOnUpdated.addListener(onTabUpdated, { properties: ['url'] });
      } catch (e) {
        tabsOnUpdated.addListener(onTabUpdated);
      }
    } else {
      tabsOnUpdated.removeListener(onTabUpdated);
    }
  } else {
    // Using onSendHeaders because onHeadersReceived in Firefox fires *after* content scripts.
    // And even in Chrome a site may be so fast that preinject on onHeadersReceived won't be useful.
    browser.webRequest.onSendHeaders[onOff](onSendHeaders, config);
  }
  if (!isApplied /* remove the listener */
  || IS_MV3 /* add CSP detector for MV3 strict pages */
  || IS_FIREFOX && !xhrInject && injectInto !== CONTENT /* add 'nonce' detector */) {
    toggleHeadersReceivedListener(onOff, config);
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
    cache.some(v => { unregisterScriptFF(v); /* must return falsy! */ });
  } else if (!xhrInject) {
    cache.destroy(); // nuking the cache so that CSAPI_REG is created for subsequent injections
  }
}

/** @param {chrome.webRequest.WebRequestHeadersDetails} info */
function onSendHeaders(info) {
  const { url, tabId } = info;
  const isTop = isTopFrame(info);
  const key = getKey(url, isTop);
  if (!cache.has(key) && !skippedTabs[tabId]) {
    prepare(key, url, isTop);
  }
}

function onTabUpdated(tabId, { url }, tab) {
  url ||= tab && tab.url;
  if (!url || !injectableRe.test(url)) return;
  const key = getKey(url, true);
  if (!cache.has(key) && !skippedTabs[tabId]) {
    prepare(key, url, true);
  }
}

/** @param {chrome.webRequest.WebResponseHeadersDetails} info */
function onHeadersReceived(info) {
  const isTop = isTopFrame(info);
  const key = getKey(info.url, isTop);
  let bag = cache.get(key);
  if (!bag && IS_MV3 && !skippedTabs[info.tabId]) {
    // onHeadersReceived may fire before tabs.onUpdated prewarm in MV3.
    bag = prepare(key, info.url, isTop);
  }
  // The INJECT data is normally already in cache if code and values aren't huge.
  // We still run CSP detection for cached env placeholders so hints can be carried
  // into prepareBag before first page-level injection attempt.
  const cspPrepare = !skippedTabs[info.tabId]
    && (IS_MV3 || IS_FIREFOX && info.url.startsWith('https:'))
    && detectStrictCsp(info, bag);
  if (bag && !skippedTabs[info.tabId]) {
    const res = !bag[FORCE_CONTENT]
      && bag[INJECT]?.[SCRIPTS]
      && xhrInject && CAN_BLOCK_WEBREQUEST
      && prepareXhrBlob(info, bag);
    return cspPrepare ? cspPrepare.then(res && (() => res)) : res;
  }
  return cspPrepare;
}

/**
 * @param {chrome.webRequest.WebResponseHeadersDetails} info
 * @param {VMInjection.Bag} bag
 */
function prepareXhrBlob({ [kResponseHeaders]: responseHeaders, [kFrameId]: frameId, tabId }, bag) {
  triageRealms(bag[INJECT][SCRIPTS], bag[FORCE_CONTENT], tabId, frameId, bag);
  const blobUrl = URL.createObjectURL(new Blob([
    JSON.stringify(bag[INJECT]),
  ]));
  responseHeaders.push({
    name: kSetCookie,
    value: `${xhrInjectKey}=${blobUrl.split('/').pop()}; SameSite=Lax`,
  });
  setTimeout(URL.revokeObjectURL, 60e3, blobUrl);
  return { [kResponseHeaders]: responseHeaders };
}

function prepare(cacheKey, url, isTop) {
  const shouldExpose = isTop && url.startsWith('https://')
    ? expose[url.split('/', 3)[2]]
    : null;
  const bagNoOp = shouldExpose != null ? BAG_NOOP_EXPOSE : BAG_NOOP;
  BAG_NOOP_EXPOSE[INJECT][EXPOSE] = shouldExpose;
  if (!isApplied) {
    return bagNoOp;
  }
  const errors = [];
  // TODO: teach `getScriptEnv` to skip prepared scripts in cache
  const env = getScriptsByURL(url, isTop, errors);
  const res = env || bagNoOp;
  cache.put(cacheKey, res); // must be called before prepareBag overwrites it synchronously
  if (env) {
    env[PROMISE] = prepareBag(cacheKey, url, isTop,
      env, shouldExpose != null ? { [EXPOSE]: shouldExpose } : {}, errors);
  }
  return res;
}

async function prepareBag(cacheKey, url, isTop, env, inject, errors) {
  if (env[PROMISE]) await env[PROMISE];
  if (!isApplied) return; // the user disabled injection while we awaited
  cache.batch(true);
  const bag = { [INJECT]: inject };
  if (env.nonce) {
    inject.nonce = env.nonce;
  }
  if (env[FORCE_CONTENT]) {
    bag[FORCE_CONTENT] = inject[FORCE_CONTENT] = true;
  }
  const { allIds, [MORE]: envDelayed } = env;
  const moreKey = envDelayed[IDS].length && getUniqId('more');
  Object.assign(inject, {
    [SCRIPTS]: prepareScripts(env),
    [INJECT_INTO]: injectInto,
    [MORE]: moreKey,
    [kSessionId]: sessionId,
    [IDS]: allIds,
    info: { ua },
    errors: errors.filter(err => allIds[err.split('#').pop()]).join('\n'),
  }, objectPick(env, [
    S_CACHE,
    'clipFF',
    'xhr',
  ]));
  propsToClear::forEachValue(val => {
    if (val !== true) bag[val] = env[val];
  });
  bag[MORE] = envDelayed;
  if (ffInject && contentScriptsAPI && !xhrInject && isTop) {
    inject[PAGE] = env[PAGE] || triagePageRealm(envDelayed);
    bag[CSAPI_REG] = registerScriptDataFF(inject, url);
  }
  if (moreKey) {
    cache.put(moreKey, envDelayed);
    envDelayed[MORE] = cacheKey;
  }
  cache.put(cacheKey, bag);
  cache.batch(false);
  return bag;
}

function prepareScripts(env) {
  env[PROMISE] = null; // let GC have it
  const scripts = env[SCRIPTS];
  for (let i = 0, script, key, id; i < scripts.length; i++) {
    script = scripts[i];
    id = script.id;
    if (!script[__CODE]) {
      id = script.props.id;
      key = S_SCRIPT_PRE + id;
      script = cache.get(key) || cache.put(key, prepareScript(script, env));
      scripts[i] = script;
    }
    if (script[INJECT_INTO] !== CONTENT) {
      env[PAGE] = true; // for registerScriptDataFF
    }
    script[VALUES] = env[S_VALUE][id] || null;
  }
  return scripts;
}

/**
 * @param {VMScript} script
 * @param {VMInjection.EnvStart} env
 * @return {VMInjection.Script}
 */
function prepareScript(script, env) {
  const { custom, meta, props } = script;
  const { id } = props;
  const { [S_REQUIRE]: require, [RUN_AT]: runAt } = env;
  const code = env[S_CODE][id];
  const dataKey = getUniqId();
  const winKey = getUniqId();
  const plantKey = { data: dataKey, win: winKey };
  const displayName = getScriptName(script);
  const pathMap = custom.pathMap || {};
  const wrap = !meta[UNWRAP];
  const wrapTryCatch = wrap && IS_FIREFOX; // FF doesn't show errors in content script's console
  const { grant, [TL_AWAIT]: topLevelAwait } = meta;
  const startIIFE = topLevelAwait ? 'await(async' : '(';
  const grantNone = grant.includes('none');
  const shouldUpdate = !!script.config.shouldUpdate;
  const enteredHookCall = `window.${SCRIPT_ENTERED_HOOK}&&window.${SCRIPT_ENTERED_HOOK}(${id});`;
  // Storing slices separately to reuse JS-internalized strings for code in our storage cache
  const injectedCode = [];
  const metaCopy = meta::mapEntry(null, pluralizeMeta);
  const metaStrMatch = METABLOCK_RE.exec(code);
  let codeIndex;
  let tmp;
  for (const key of META_KEYS_TO_ENSURE) {
    if (metaCopy[key] == null) metaCopy[key] = '';
  }
  for (const [key, from] of META_KEYS_TO_ENSURE_FROM) {
    if (!metaCopy[key] && (tmp = metaCopy[from])) {
      metaCopy[key] = tmp;
    }
  }
  metaCopy.options = { // TM-compatibility
    check_for_updates: shouldUpdate,
    inject_into: custom[INJECT_INTO] || null,
    noframes: custom.noframes ?? null,
    override: {
      merge_excludes: !!custom.origExclude,
      merge_includes: !!custom.origInclude,
      merge_matches: !!custom.origMatch,
      merge_exclude_matches: !!custom.origExcludeMatch,
      use_excludes: custom.exclude || [],
      use_includes: custom.include || [],
      use_matches: custom.match || [],
      use_exclude_matches: custom.excludeMatch || [],
    },
    run_at: custom[RUN_AT] || null,
    tags: custom.tags?.split(' ').filter(Boolean) || [],
    user_modified: script.props.lastModified || 0,
  };
  if (wrap) {
    // TODO: push winKey/dataKey as separate chunks so we can change them for each injection?
    injectedCode.push('window.', winKey, '=',
      wrapTryCatch && topLevelAwait ? 'async ' : '',
      'function ', dataKey, '(',
      // using a shadowed name to avoid scope pollution
      grantNone ? GRANT_NONE_VARS : 'GM',
      wrapTryCatch ? `,${dataKey}){try{` : '){',
      enteredHookCall,
      grantNone ? '' : 'with(this)with(c)delete c,',
      !topLevelAwait ? '(' : wrapTryCatch ? startIIFE : '(async',
      // hiding module interface from @require'd scripts so they don't mistakenly use it
      '(define,module,exports)=>{');
  }
  tmp = false;
  for (const url of meta[S_REQUIRE]) {
    const req = require[pathMap[url] || url] || `/* ${VIOLENTMONKEY} is missing @require ${
      url.replace(/\*\//g, '%2A/')
    }\n${kTryVacuuming} */`;
    if (/\S/.test(req)) {
      injectedCode.push(...[
        tmp && isUnsafeConcat(req) && ';',
        req,
        !NEWLINE_END_RE.test(req) && '\n',
      ].filter(Boolean));
      tmp = true;
    }
  }
  if (tmp && isUnsafeConcat(code)) {
    injectedCode.push(';');
  }
  // @unwrap scripts bypass VM wrapper, so trigger startup ACK directly as the first statement.
  if (!wrap) {
    injectedCode.push(enteredHookCall);
  }
  codeIndex = injectedCode.length;
  injectedCode.push(code);
  // adding a new line in case the code ends with a line comment
  injectedCode.push(...[
    !NEWLINE_END_RE.test(code) && '\n',
    wrapTryCatch ? `})()}catch(e){${dataKey}(e)}}` : wrap && `})()}`,
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    IS_FIREFOX && ';0',
    '\n//# sourceURL=', getScriptPrettyUrl(script, displayName),
  ].filter(Boolean));
  return {
    code: '',
    displayName,
    gmi: {
      scriptWillUpdate: shouldUpdate,
      uuid: props.uuid,
    },
    id,
    key: plantKey,
    meta: metaCopy,
    pathMap,
    [__CODE]: injectedCode,
    [INJECT_INTO]: normalizeScriptRealm(custom, meta),
    [META_STR]: [
      '',
      codeIndex,
      tmp = metaStrMatch && (metaStrMatch.index + metaStrMatch[1].length),
      tmp + metaStrMatch?.[4].length,
    ],
    [RUN_AT]: runAt[id],
  };
}

function triageRealms(scripts, forceContent, tabId, frameId, bag) {
  // Run content-realm scripts locally in the isolated world via Function(code)().
  // The isolated-world defineProperty setter fires when the same world sets window[winKey],
  // allowing onCodeSet to call fn(gm) and execute the userscript with GM APIs.
  // Background-side MAIN-world injection is NOT used because Chrome's isolated world does
  // not share property descriptors with MAIN world — the setter never fires cross-world.
  // When the page's CSP nonce is available (MV3), we route AUTO scripts to PAGE realm
  // so nonce-tagged <script> injection in MAIN world uses the same-world setter.
  const shouldInjectViaBackground = false;
  const nonceAvailable = IS_MV3 && !forceContent && !!bag?.[INJECT]?.nonce;
  let code;
  let wantsPage;
  const toContent = [];
  for (const /**@type{VMInjection.Script}*/ scr of scripts) {
    const metaStr = scr[META_STR];
    const runAsContent = (IS_MV3 && !nonceAvailable) || isContentRealm(scr[INJECT_INTO], forceContent);
    if (runAsContent) {
      if (!metaStr[0]) {
        const [, i, from, to] = metaStr;
        metaStr[0] = scr[__CODE][i].slice(from, to);
      }
      if (shouldInjectViaBackground) {
        code = '';
        toContent.push([scr.id, scr.key.data]);
      } else {
        // MV3: content script executes this wrapper locally via Function().
        code = scr[__CODE].join('');
      }
    } else {
      metaStr[0] = '';
      code = forceContent ? ID_BAD_REALM : scr[__CODE];
      if (!forceContent) wantsPage = true;
    }
    scr.code = code;
  }
  if (bag) {
    bag[INJECT][PAGE] = IS_MV3
      ? nonceAvailable && (wantsPage || triagePageRealm(bag[MORE]))
      : wantsPage || triagePageRealm(bag[MORE]);
  }
  if (shouldInjectViaBackground && toContent[0]) {
    // Processing known feedback without waiting for InjectionFeedback message.
    // Running in a separate task as executeScript may take a long time to serialize code.
    setTimeout(injectContentRealm, 0, toContent, tabId, frameId);
  }
}

function triagePageRealm(env, forceContent) {
  return env?.[SCRIPTS].some(isPageRealmScript, forceContent || null);
}

function injectContentRealm(toContent, tabId, frameId) {
  for (const [id, dataKey] of toContent) {
    const scr = cache.get(S_SCRIPT_PRE + id); // TODO: recreate if expired?
    if (!scr || scr.key.data !== dataKey) continue;
    let code = scr[__CODE].join('');
    if (IS_MV3) {
      // For USER_SCRIPT world: append self-invocation with an inline GM API backed by
      // chrome.runtime.sendMessage (available when world is configured with messaging:true).
      // USER_SCRIPT world bypasses page CSP for code execution (no eval/Function restriction),
      // but the isolated-world defineProperty setter on window[winKey] won't fire cross-world.
      // Self-invocation bypasses the setter mechanism by calling the wrapper directly.
      const winKeyJson = JSON.stringify(scr.key.win);
      const scriptIdStr = String(id);
      const gmInfoJson = JSON.stringify({
        scriptHandler: 'Violentmonkey',
        scriptWillUpdate: !!scr.gmi?.scriptWillUpdate,
        uuid: scr.gmi?.uuid || '',
        script: {
          name: scr.meta?.name || '',
          namespace: scr.meta?.namespace || '',
          version: scr.meta?.version || '',
          description: scr.meta?.description || '',
          matches: scr.meta?.matches || [],
          grant: scr.meta?.grant || [],
        },
      });
      // language=js
      code = `${code}
;(function __vmUSWInvoke(){
var _fn=window[${winKeyJson}];
if(typeof _fn!=='function')return;
delete window[${winKeyJson}];
var _inf=${gmInfoJson};
function _xhr(o){
  if(!o||!o.url)return;
  var _opts={method:o.method||'GET',url:o.url,
    headers:o.headers||{},data:o.data||null,
    anonymous:!!o.anonymous,responseType:o.responseType||'',
    timeout:+(o.timeout)||0};
  chrome.runtime.sendMessage(
    {__vmGM:1,fn:'xhr',scriptId:${JSON.stringify(scriptIdStr)},opts:_opts},
    function(r){
      if(chrome.runtime.lastError){
        var e={status:0,statusText:chrome.runtime.lastError.message||'Error',
          responseText:'',finalUrl:o.url||'',readyState:4};
        o.onerror&&o.onerror(e);
      }else if(r&&r.__vmError){
        o.onerror&&o.onerror(r.__vmError);
      }else if(r){
        if(r.__vmTimeout){o.ontimeout&&o.ontimeout(r.__vmTimeout);}
        else{o.onreadystatechange&&o.onreadystatechange(r);o.onload&&o.onload(r);}
      }
    });
  return{abort:function(){}};
}
var GM={xmlHttpRequest:_xhr,GM_xmlhttpRequest:_xhr,
  getValue:function(){return undefined;},setValue:function(){},
  deleteValue:function(){},listValues:function(){return[];},
  openInTab:function(){},setClipboard:function(){},notification:function(){},
  info:_inf,GM_info:_inf};
// VM wrapper uses with(this)with(c)delete c, so this.c must equal the GM API context.
// Call with {c:GM} as the receiver so the with(c) clause resolves correctly.
_fn.call({c:GM},GM,function(e){console.error('[VM]',e)});
})();`;
    }
    const baseOptions = {
      code,
      [RUN_AT]: `document_${scr[RUN_AT]}`.replace('body', 'start'),
      ...frameId > 0 && { [kFrameId]: frameId },
      tryUserScripts: IS_MV3,
      preferRegister: IS_MV3 && frameId <= 0,
      allowLegacyCodeFallback: !IS_MV3,
    };
    // Always notify content that the script ran so the tardy queue clears.
    // Non-UNWRAP scripts run in MAIN/USER_SCRIPT world where window.__VM_SCRIPT_ENTERED__
    // is invisible (world boundary), so ScriptEntered never fires from the wrapper.
    // The background must send Run(id) explicitly for every successfully executed script.
    executeContentRealmWithImmediateFallback(tabId, frameId, scr, baseOptions)
      .then(result => result?.length && sendTabCmd(tabId, 'Run', id, { [kFrameId]: frameId }))
      .catch((error) => {
        logBackgroundError('userscript.content.execute.failed', error, {
          scriptId: id,
          scriptName: scr.displayName,
          runAt: scr[RUN_AT],
          realm: 'content',
          phase: 'execute-script',
          sender: {
            tabId,
            frameId,
          },
        }, {
          alert: false,
          source: 'background',
          phase: 'execute-script',
        });
      });
  }
}

async function executeContentRealmWithImmediateFallback(tabId, frameId, scr, baseOptions) {
  const immediateAttempts = IS_MV3
    ? [{
      // USER_SCRIPT world bypasses page CSP; the self-invoking code in injectContentRealm
      // calls the wrapper directly so no cross-world window prop setter is needed.
      // MAIN world attempt removed: cross-world defineProperty setters never fire, and
      // MAIN world lacks chrome.runtime.sendMessage for the inline GM API stubs.
      label: 'userscript-world-execute',
      options: {
        ...baseOptions,
        preferRegister: false,
        allowRegisterFallback: true,
        allowLegacyCodeFallback: false,
      },
    }]
    : [{
      label: 'legacy-execute',
      options: baseOptions,
    }];
  let lastError = '';
  for (const attempt of immediateAttempts) {
    try {
      const result = await executeScriptInTab(tabId, attempt.options);
      if (result?.length) {
        logBackgroundAction('userscript.content.execute.attempt', {
          scriptId: scr.id,
          scriptName: scr.displayName,
          runAt: scr[RUN_AT],
          realm: 'content',
          phase: 'execute-script',
          attempt: attempt.label,
          resultCount: result.length,
          sender: {
            tabId,
            frameId,
          },
        }, 'debug');
        return result;
      }
      lastError = `No execution results returned by ${attempt.label}.`;
      logBackgroundAction('userscript.content.execute.attempt', {
        scriptId: scr.id,
        scriptName: scr.displayName,
        runAt: scr[RUN_AT],
        realm: 'content',
        phase: 'execute-script',
        attempt: attempt.label,
        resultCount: result?.length || 0,
        lastError,
        sender: { tabId, frameId },
      }, 'debug');
    } catch (error) {
      lastError = `${error?.message || error || ''}`.slice(0, 400);
      logBackgroundAction('userscript.content.execute.attempt.error', {
        scriptId: scr.id,
        scriptName: scr.displayName,
        runAt: scr[RUN_AT],
        realm: 'content',
        phase: 'execute-script',
        attempt: attempt.label,
        error: lastError,
        sender: { tabId, frameId },
      }, 'debug');
    }
  }
  // Fallback: use scripting.executeScript with a safe Function wrapper in isolated world.
  try {
    const result = await executeScriptInTab(tabId, {
      func: (source) => {
        try { (0, eval)(source); return true; } catch (e) { return `err:${e?.message || e}`; }
      },
      args: [baseOptions.code],
      ...frameId > 0 && { [kFrameId]: frameId },
      [RUN_AT]: baseOptions[RUN_AT],
    });
    if (result?.length && result[0] === true) {
      logBackgroundAction('userscript.content.execute.fallback.func', {
        scriptId: scr.id,
        scriptName: scr.displayName,
        runAt: scr[RUN_AT],
        realm: 'content',
        phase: 'execute-script',
      }, 'debug');
      return result;
    }
    logBackgroundAction('userscript.content.execute.fallback.func', {
      scriptId: scr.id,
      scriptName: scr.displayName,
      runAt: scr[RUN_AT],
      realm: 'content',
      phase: 'execute-script',
      result: result?.[0] || null,
    }, 'debug');
  } catch (e) {
    lastError = `${e?.message || e || ''}`.slice(0, 400);
    logBackgroundAction('userscript.content.execute.fallback.func.error', {
      scriptId: scr.id,
      scriptName: scr.displayName,
      runAt: scr[RUN_AT],
      realm: 'content',
      phase: 'execute-script',
      error: lastError,
    }, 'debug');
  }
  if (IS_MV3) {
    const registeredIso = await registerIsolatedContentScriptOnce(tabId, {
      code: baseOptions.code,
      [RUN_AT]: baseOptions[RUN_AT],
      allFrames: baseOptions.allFrames,
    });
    logBackgroundAction('userscript.content.register.isolated', {
      scriptId: scr.id,
      success: registeredIso,
      runAt: scr[RUN_AT],
      tabId,
      frameId,
    }, 'debug');
    if (registeredIso) return [true];
  }
  if (IS_MV3 && frameId <= 0) {
    const registered = await registerMainWorldContentScriptOnce(tabId, {
      code: baseOptions.code,
      [RUN_AT]: baseOptions[RUN_AT],
      allFrames: baseOptions.allFrames,
    });
    logBackgroundAction('userscript.content.register.main', {
      scriptId: scr.id,
      success: registered,
      runAt: scr[RUN_AT],
      tabId,
      frameId,
    }, 'debug');
    if (registered) {
      return [true];
    }
  }
  if (IS_MV3 && frameId <= 0) {
    // Best-effort registration keeps pre-135 runtimes working on a subsequent navigation.
    await executeScriptInTab(tabId, {
      ...baseOptions,
      world: 'MAIN',
      preferRegister: true,
      allowRegisterFallback: true,
    }).catch(() => {});
  }
  throw new SafeError(lastError || 'Immediate userscripts execution returned no results.');
}

// TODO: rework the whole thing to register scripts individually with real `matches`
// (this will also allow proper handling of @noframes)
function registerScriptDataFF(inject, url) {
  for (const scr of inject[SCRIPTS]) {
    scr.code = scr[__CODE];
  }
  return contentScriptsAPI.register({
    js: [{
      code: `${resolveDataCodeStr}(this,${JSON.stringify(inject)})`,
    }],
    matches: url.split('#', 1),
    [RUN_AT]: 'document_start',
  });
}

function unregisterScriptFF(bag) {
  const reg = bag[CSAPI_REG];
  if (reg) {
    delete bag[CSAPI_REG];
    return reg.then(r => r.unregister());
  }
}

/**
 * @param {chrome.webRequest.WebResponseHeadersDetails} info
 * @param {VMInjection.Bag} bag
 */
function detectStrictCsp(info, bag) {
  // Analyze ALL Content-Security-Policy headers.
  // Pages may send multiple CSP headers (AND-ed by the browser). A nonce from one
  // header won't help if another header's strict script-src lacks it.
  let nonce;
  let forceContent;
  for (const h of info[kResponseHeaders]) {
    if (!findCspHeader(h)) continue;
    const result = analyzeCspForInject(h.value);
    if (!result) continue;
    if (result.forceContent) {
      forceContent = true;
    } else if (result.nonce) {
      if (nonce && nonce !== result.nonce) forceContent = true; // conflicting nonces
      else nonce = result.nonce;
    }
  }
  // If any header blocks inline without nonce, nonce-based injection won't work
  const cspResult = forceContent ? { forceContent: true }
    : nonce ? { nonce }
    : undefined;
  if (!cspResult) return;
  if (IS_MV3 && info.tabId >= 0) {
    publishCspHint(getCspHintKey(info.tabId, info.url), cspResult, 'headers');
  }
  if (!bag) return;
  return applyCspResultToBag(cspResult, bag, info.url);
}

function applyCspResultToBag(cspResult, bag, url) {
  const hasInjectData = !!bag[INJECT]?.[SCRIPTS];
  const isMutableBag = bag !== BAG_NOOP && bag !== BAG_NOOP_EXPOSE;
  if (cspResult.nonce) {
    if (hasInjectData) {
      bag[INJECT].nonce = cspResult.nonce;
    } else if (isMutableBag) {
      bag.nonce = cspResult.nonce;
    }
  } else if (cspResult.forceContent) {
    if (hasInjectData) {
      bag[FORCE_CONTENT] = bag[INJECT][FORCE_CONTENT] = true;
    } else if (isMutableBag) {
      bag[FORCE_CONTENT] = true;
    }
  } else {
    return;
  }
  if (!hasInjectData) return;
  const unregistered = unregisterScriptFF(bag);
  if (unregistered && !cspResult.nonce) {
    // Registering only without nonce, otherwise FF will incorrectly reuse it on tab reload
    return Promise.all([
      unregistered,
      bag[CSAPI_REG] = registerScriptDataFF(bag[INJECT], url),
    ]);
  }
}

/** @this {?} truthy = forceContent */
function isPageRealmScript(scr) {
  return !isContentRealm(scr[INJECT_INTO] || normalizeScriptRealm(scr.custom, scr.meta), this);
}

function onTabRemoved(id /* , info */) {
  clearFrameData(id, 0, true);
  const prefix = `${id}\n`;
  for (const key in cspHints) {
    if (key.startsWith(prefix)) delete cspHints[key];
  }
  for (const key in cspHintWaiters) {
    if (key.startsWith(prefix)) delete cspHintWaiters[key];
  }
  delete skippedTabs[id];
}

function publishCspHint(key, hint, source = 'unknown') {
  cspHints[key] = hint;
  logCspHintLifecycle('preinject.cspHint.publish', key, {
    source,
    forceContent: !!hint?.forceContent,
    nonce: !!hint?.nonce,
  });
  const waiters = cspHintWaiters[key];
  if (!waiters) return;
  delete cspHintWaiters[key];
  for (const resolve of waiters) {
    resolve(hint);
  }
}

function waitForCspHint(key) {
  if (cspHints[key]) {
    logCspHintLifecycle('preinject.cspHint.wait.hit', key, {
      forceContent: !!cspHints[key]?.forceContent,
      nonce: !!cspHints[key]?.nonce,
    });
    return Promise.resolve(cspHints[key]);
  }
  logCspHintLifecycle('preinject.cspHint.wait.start', key, {
    timeoutMs: CSP_HINT_WAIT_MS,
  });
  return new Promise(resolve => {
    const waiter = hint => {
      clearTimeout(timeout);
      logCspHintLifecycle('preinject.cspHint.wait.resolve', key, {
        forceContent: !!hint?.forceContent,
        nonce: !!hint?.nonce,
      });
      resolve(hint);
    };
    const timeout = setTimeout(() => {
      const waiters = cspHintWaiters[key];
      if (waiters) {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        if (!waiters.length) delete cspHintWaiters[key];
      }
      logCspHintLifecycle('preinject.cspHint.wait.timeout', key, {
        timeoutMs: CSP_HINT_WAIT_MS,
        forceContent: !!cspHints[key]?.forceContent,
        nonce: !!cspHints[key]?.nonce,
      });
      resolve(cspHints[key]);
    }, CSP_HINT_WAIT_MS);
    (cspHintWaiters[key] || (cspHintWaiters[key] = [])).push(waiter);
  });
}

function logCspHintLifecycle(action, key, details) {
  const splitAt = key.indexOf('\n');
  const tabId = splitAt > 0 ? +key.slice(0, splitAt) : null;
  const url = splitAt > 0 ? key.slice(splitAt + 1) : key;
  logBackgroundAction(action, {
    ...tabId >= 0 && { tabId },
    ...url && { url: getBaseUrl(url) },
    ...details,
  }, 'debug');
}

function onTabReplaced(addedId, removedId) {
  onTabRemoved(removedId);
}

function clearFrameData(tabId, frameId, tabRemoved) {
  clearRequestsByTabId(tabId, frameId);
  clearValueOpener(tabId, frameId);
  clearNotifications(tabId, frameId, tabRemoved);
}

function sendPopupShown(tabId, frameDoc) {
  setTimeout(sendTabCmd, 0, tabId, 'PopupShown', true, getFrameDocIdAsObj(frameDoc));
}
