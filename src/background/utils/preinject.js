import { getActiveTab, getScriptName, getScriptPrettyUrl, getUniqId, sendTabCmd } from '@/common';
import {
  __CODE, TL_AWAIT, UNWRAP,
  BLACKLIST, HOMEPAGE_URL, KNOWN_INJECT_INTO, META_STR, METABLOCK_RE, NEWLINE_END_RE,
} from '@/common/consts';
import initCache from '@/common/cache';
import {
  deepCopy, forEachEntry, forEachValue, mapEntry, objectPick, objectSet,
} from '@/common/object';
import { CACHE_KEYS, getScriptsByURL, PROMISE, REQ_KEYS, VALUE_IDS } from './db';
import { setBadge } from './icon';
import { addOwnCommands, addPublicCommands } from './init';
import { clearNotifications } from './notifications';
import { hookOptionsInit } from './options';
import { popupTabs } from './popup-tracker';
import { clearRequestsByTabId, reifyRequests } from './requests';
import { kSetCookie } from './requests-core';
import {
  S_CACHE, S_CACHE_PRE, S_CODE, S_CODE_PRE, S_REQUIRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE,
  S_VALUE_PRE,
} from './storage';
import { clearStorageCache, onStorageChanged } from './storage-cache';
import { getFrameDocId, getFrameDocIdAsObj, tabsOnRemoved } from './tabs';
import { addValueOpener, clearValueOpener, reifyValueOpener } from './values';
import { ua } from './ua';

let isApplied;
let injectInto;
let ffInject;
let xhrInject = false; // must be initialized for proper comparison when toggling
let vivaldiChecked = IS_FIREFOX;

const sessionId = getUniqId();
const API_HEADERS_RECEIVED = browser.webRequest.onHeadersReceived;
const API_CONFIG = {
  urls: ['*://*/*'], // `*` scheme matches only http and https
  types: ['main_frame', 'sub_frame'],
};
const API_EXTRA = [
  'blocking', // used for xhrInject and to make Firefox fire the event before GetInjected
  kResponseHeaders,
  browser.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS,
].filter(Boolean);
const findCspHeader = h => h.name.toLowerCase() === 'content-security-policy';
const CSP_RE = /(?:^|[;,])\s*(?:script-src(-elem)?|(d)efault-src)(\s+[^;,]+)/g;
const NONCE_RE = /'nonce-([-+/=\w]+)'/;
const UNSAFE_INLINE = "'unsafe-inline'";
/** These bags are reused in cache to reduce memory usage,
 * CACHE_KEYS is for removeStaleCacheEntry */
const BAG_NOOP = { [INJECT]: {}, [CACHE_KEYS]: [] };
const BAG_NOOP_EXPOSE = { ...BAG_NOOP, [INJECT]: { [EXPOSE]: true, [kSessionId]: sessionId } };
const CSAPI_REG = 'csReg';
const contentScriptsAPI = browser.contentScripts;
const cache = initCache({
  lifetime: 5 * 60e3,
  onDispose(val) {
    val[CSAPI_REG]?.then(reg => reg.unregister());
    cache.del(val[MORE]);
  },
});
// KEY_XXX for hooked options
const GRANT_NONE_VARS = '{GM,GM_info,unsafeWindow,cloneInto,createObjectIn,exportFunction}';
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
  const reg = bag && unregisterScriptFF(bag);
  skippedTabs[tabId] = 1;
  if (reg) await reg;
  clearFrameData(tabId);
  await browser.tabs.reload(tabId);
};

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
  async GetInjected({ url, [FORCE_CONTENT]: forceContent, done }, src) {
    const { tab, [kFrameId]: frameId, [kTop]: isTop } = src;
    const frameDoc = getFrameDocId(isTop, src[kDocumentId], frameId);
    const tabId = tab.id;
    if (!url) url = src.url || tab.url;
    if (!vivaldiChecked) checkVivaldi(tab);
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
    const scripts = inject[SCRIPTS];
    if (scripts) {
      triageRealms(scripts, bag[FORCE_CONTENT] || forceContent, tabId, frameId, bag);
      addValueOpener(scripts, tabId, frameDoc);
    }
    if (popupTabs[tabId]) {
      sendPopupShown(tabId, frameDoc);
    }
    return isApplied
      ? !done && inject
      : { [INJECT_INTO]: 'off', ...inject };
  },
  async InjectionFeedback({
    [FORCE_CONTENT]: forceContent,
    [CONTENT]: items,
    [MORE]: moreKey,
    url,
  }, src) {
    const { tab, [kFrameId]: frameId } = src;
    const isTop = src[kTop];
    const tabId = tab.id;
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
    return {
      [SCRIPTS]: scripts,
      [S_CACHE]: envCache,
    };
  },
  Run({ [IDS]: ids, reset }, src) {
    const {
      [kDocumentId]: docId,
      [kTop]: isTop,
      tab: { id: tabId },
    } = src;
    const hasIds = +ids?.[0];
    setBadge(ids, reset, src);
    if (isTop === 3) {
      if (hasIds) reifyValueOpener(ids, docId);
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
  if (enable) enable = injectInto !== CONTENT;
  if (xhrInject === enable) return;
  xhrInject = enable;
  cache.destroy();
  API_HEADERS_RECEIVED.removeListener(onHeadersReceived);
  if (enable) {
    API_HEADERS_RECEIVED.addListener(onHeadersReceived, API_CONFIG, API_EXTRA);
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

/** @param {chrome.webRequest.WebResponseHeadersDetails} info */
function onHeadersReceived(info) {
  const key = getKey(info.url, isTopFrame(info));
  const bag = cache.get(key);
  // The INJECT data is normally already in cache if code and values aren't huge
  if (bag && !bag[FORCE_CONTENT] && bag[INJECT]?.[SCRIPTS] && !skippedTabs[info.tabId]) {
    const ffReg = IS_FIREFOX && info.url.startsWith('https:')
      && detectStrictCsp(info, bag);
    const res = xhrInject && prepareXhrBlob(info, bag);
    return ffReg ? ffReg.then(res && (() => res)) : res;
  }
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
    value: `"${process.env.INIT_FUNC_NAME}"=${blobUrl.split('/').pop()}; SameSite=Lax`,
  });
  setTimeout(URL.revokeObjectURL, 60e3, blobUrl);
  return { [kResponseHeaders]: responseHeaders };
}

function prepare(cacheKey, url, isTop) {
  const shouldExpose = isTop && url.startsWith('https://') && expose[url.split('/', 3)[2]];
  const bagNoOp = shouldExpose != null ? BAG_NOOP_EXPOSE : BAG_NOOP;
  BAG_NOOP_EXPOSE[INJECT][EXPOSE] = shouldExpose;
  if (!isApplied) {
    return bagNoOp;
  }
  const errors = [];
  // TODO: teach `getScriptEnv` to skip prepared scripts in cache
  const env = getScriptsByURL(url, isTop, errors);
  if (env) {
    env[PROMISE] = prepareBag(cacheKey, url, isTop,
      env, shouldExpose != null ? { [EXPOSE]: shouldExpose } : {}, errors);
  }
  return cache.put(cacheKey, env || bagNoOp);
}

async function prepareBag(cacheKey, url, isTop, env, inject, errors) {
  await env[PROMISE];
  cache.batch(true);
  const bag = { [INJECT]: inject };
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
  const numGrants = grant.length;
  const grantNone = !numGrants || numGrants === 1 && grant[0] === 'none';
  // Storing slices separately to reuse JS-internalized strings for code in our storage cache
  const injectedCode = [];
  const metaCopy = meta::mapEntry(null, pluralizeMeta);
  const metaStrMatch = METABLOCK_RE.exec(code);
  let hasReqs;
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
  if (wrap) {
    // TODO: push winKey/dataKey as separate chunks so we can change them for each injection?
    injectedCode.push('window.', winKey, '=',
      wrapTryCatch && topLevelAwait ? 'async ' : '',
      'function ', dataKey, '(',
      // using a shadowed name to avoid scope pollution
      grantNone ? GRANT_NONE_VARS : 'GM',
      wrapTryCatch ? `,${dataKey}){try{` : '){',
      grantNone ? '' : 'with(this)with(c)delete c,',
      !topLevelAwait ? '(' : wrapTryCatch ? startIIFE : '(async',
      // hiding module interface from @require'd scripts so they don't mistakenly use it
      '(define,module,exports)=>{');
  }
  for (const url of meta[S_REQUIRE]) {
    const req = require[pathMap[url] || url];
    if (/\S/.test(req)) {
      injectedCode.push(req, NEWLINE_END_RE.test(req) ? ';' : '\n;');
      hasReqs = true;
    }
  }
  // adding a nested IIFE to support 'use strict' in the code when there are @requires
  if (hasReqs && wrap) {
    injectedCode.push(startIIFE, '()=>{');
  }
  codeIndex = injectedCode.length;
  injectedCode.push(code);
  // adding a new line in case the code ends with a line comment
  injectedCode.push(...[
    !NEWLINE_END_RE.test(code) ? '\n' : '',
    hasReqs && wrap ? '})()' : '',
    wrapTryCatch ? `})()}catch(e){${dataKey}(e)}}` : wrap ? `})()}` : '',
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    IS_FIREFOX ? ';0' : '',
    '\n//# sourceURL=', getScriptPrettyUrl(script, displayName),
  ].filter(Boolean));
  return {
    code: '',
    displayName,
    gmi: {
      scriptWillUpdate: !!script.config.shouldUpdate,
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
      tmp = (metaStrMatch.index + metaStrMatch[1].length),
      tmp + metaStrMatch[2].length,
    ],
    [RUN_AT]: runAt[id],
  };
}

function triageRealms(scripts, forceContent, tabId, frameId, bag) {
  let code;
  let wantsPage;
  const toContent = [];
  for (const scr of scripts) {
    const metaStr = scr[META_STR];
    if (isContentRealm(scr[INJECT_INTO], forceContent)) {
      if (!metaStr[0]) {
        const [, i, from, to] = metaStr;
        metaStr[0] = scr[__CODE][i].slice(from, to);
      }
      code = '';
      toContent.push([scr.id, scr.key.data]);
    } else {
      metaStr[0] = '';
      code = forceContent ? ID_BAD_REALM : scr[__CODE];
      if (!forceContent) wantsPage = true;
    }
    scr.code = code;
  }
  if (bag) {
    bag[INJECT][PAGE] = wantsPage || triagePageRealm(bag[MORE]);
  }
  if (toContent[0]) {
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
    browser.tabs.executeScript(tabId, {
      code: scr[__CODE].join(''),
      [RUN_AT]: `document_${scr[RUN_AT]}`.replace('body', 'start'),
      [kFrameId]: frameId,
    }).then(scr.meta[UNWRAP] && (() => sendTabCmd(tabId, 'Run', id, { [kFrameId]: frameId })));
  }
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
  const h = info[kResponseHeaders].find(findCspHeader);
  if (!h) return;
  let tmp = '';
  let m, scriptSrc, scriptElemSrc, defaultSrc;
  while ((m = CSP_RE.exec(h.value))) {
    tmp += m[2] ? (defaultSrc = m[3]) : m[1] ? (scriptElemSrc = m[3]) : (scriptSrc = m[3]);
  }
  if (!tmp) return;
  tmp = tmp.match(NONCE_RE);
  if (tmp) {
    bag[INJECT].nonce = tmp[1];
  } else if (
    scriptSrc && !scriptSrc.includes(UNSAFE_INLINE) ||
    scriptElemSrc && !scriptElemSrc.includes(UNSAFE_INLINE) ||
    !scriptSrc && !scriptElemSrc && defaultSrc && !defaultSrc.includes(UNSAFE_INLINE)
  ) {
    bag[FORCE_CONTENT] = bag[INJECT][FORCE_CONTENT] = true;
  } else {
    return;
  }
  m = unregisterScriptFF(bag);
  if (m && !tmp) {
    // Registering only without nonce, otherwise FF will incorrectly reuse it on tab reload
    return Promise.all([
      m,
      bag[CSAPI_REG] = registerScriptDataFF(bag[INJECT], info.url),
    ]);
  }
}

/** @this {?} truthy = forceContent */
function isPageRealmScript(scr) {
  return !isContentRealm(scr[INJECT_INTO] || normalizeScriptRealm(scr.custom, scr.meta), this);
}

function onTabRemoved(id /* , info */) {
  clearFrameData(id, 0, true);
  delete skippedTabs[id];
}

function onTabReplaced(addedId, removedId) {
  onTabRemoved(removedId);
}

function clearFrameData(tabId, frameId, tabRemoved) {
  clearRequestsByTabId(tabId, frameId);
  clearValueOpener(tabId, frameId);
  clearNotifications(tabId, frameId, tabRemoved);
}

function checkVivaldi(tab) {
  vivaldiChecked = true;
  if (tab.vivExtData/*new*/ || tab.extData/*old*/) {
    ua.brand = ua.browserBrand = 'Vivaldi';
  }
}

function sendPopupShown(tabId, frameDoc) {
  setTimeout(sendTabCmd, 0, tabId, 'PopupShown', true, getFrameDocIdAsObj(frameDoc));
}
