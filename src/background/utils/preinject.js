import { getScriptName, getScriptPrettyUrl, getUniqId, sendTabCmd } from '@/common';
import {
  BLACKLIST, HOMEPAGE_URL, KNOWN_INJECT_INTO, META_STR, METABLOCK_RE, NEWLINE_END_RE,
} from '@/common/consts';
import initCache from '@/common/cache';
import { forEachEntry, forEachKey, forEachValue, mapEntry, objectSet } from '@/common/object';
import ua from '@/common/ua';
import { getScriptsByURL, CACHE_KEYS, PROMISE, REQ_KEYS, VALUE_IDS } from './db';
import { postInitialize } from './init';
import { addPublicCommands } from './message';
import { getOption, hookOptions } from './options';
import { popupTabs } from './popup-tracker';
import { clearRequestsByTabId } from './requests';
import {
  S_CACHE, S_CACHE_PRE, S_CODE, S_CODE_PRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE, S_VALUE_PRE,
} from './storage';
import { clearStorageCache, onStorageChanged } from './storage-cache';
import { addValueOpener, clearValueOpener } from './values';

let isApplied;
let injectInto;
let ffInject;
let xhrInject;

const sessionId = getUniqId();
const API_CONFIG = {
  urls: ['*://*/*'], // `*` scheme matches only http and https
  types: ['main_frame', 'sub_frame'],
};
const __CODE = Symbol('code'); // will be stripped when messaging
const INJECT = 'inject';
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
const UNWRAP = 'unwrap';
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
const OPT_HANDLERS = {
  [BLACKLIST]: cache.destroy,
  defaultInjectInto(value) {
    injectInto = normalizeRealm(value);
    cache.destroy();
  },
  /** WARNING! toggleXhrInject should precede togglePreinject as it sets xhrInject variable */
  xhrInject: toggleXhrInject,
  isApplied: togglePreinject,
  [EXPOSE](value) {
    value::forEachEntry(([site, isExposed]) => {
      expose[decodeURIComponent(site)] = isExposed;
    });
  },
};
if (contentScriptsAPI) OPT_HANDLERS.ffInject = toggleFastFirefoxInject;

addPublicCommands({
  /** @return {Promise<VMInjection>} */
  async GetInjected({ url, [FORCE_CONTENT]: forceContent, done }, src) {
    const { frameId, tab } = src;
    const tabId = tab.id;
    const isTop = !frameId;
    if (!url) url = src.url || tab.url;
    clearFrameData(tabId, frameId);
    const bagKey = getKey(url, isTop);
    const bagP = cache.get(bagKey) || prepare(bagKey, url, isTop);
    const bag = bagP[INJECT] ? bagP : await bagP[PROMISE];
    /** @type {VMInjection} */
    const inject = bag[INJECT];
    const scripts = inject[SCRIPTS];
    if (scripts) {
      triageRealms(scripts, bag[FORCE_CONTENT] || forceContent, tabId, frameId, bag);
      addValueOpener(scripts, tabId, frameId);
    }
    if (popupTabs[tabId]) {
      setTimeout(sendTabCmd, 0, tabId, 'PopupShown', popupTabs[tabId], { frameId });
    }
    return !done && inject;
  },
  async InjectionFeedback({
    [FORCE_CONTENT]: forceContent,
    [CONTENT]: items,
    [MORE]: moreKey,
    url,
  }, src) {
    const { frameId, tab } = src;
    const tabId = tab.id;
    injectContentRealm(items, tabId, frameId);
    if (!moreKey) return;
    if (!url) url = src.url || tab.url;
    const env = cache.get(moreKey)
      || cache.put(moreKey, getScriptsByURL(url, !frameId));
    const envCache = (env[PROMISE] ? await env[PROMISE] : env)[S_CACHE];
    const scripts = prepareScripts(env);
    triageRealms(scripts, forceContent, tabId, frameId);
    addValueOpener(scripts, tabId, frameId);
    return {
      [SCRIPTS]: scripts,
      [S_CACHE]: envCache,
    };
  },
});

hookOptions(onOptionChanged);
postInitialize.push(() => {
  OPT_HANDLERS::forEachKey(key => {
    onOptionChanged({ [key]: getOption(key) });
  });
});

onStorageChanged(({ keys }) => {
  cache.some(removeStaleCacheEntry, keys.map((key, i) => [
    key.slice(0, i = key.indexOf(':') + 1),
    key.slice(i),
  ]));
});

/** @this {string[][]} changed storage keys, already split as [prefix,id] */
function removeStaleCacheEntry(val, key) {
  if (!val[CACHE_KEYS]) return;
  for (const [prefix, id] of this) {
    const prop = propsToClear[prefix];
    if (prop === true) {
      cache.destroy(); // TODO: try to patch the cache in-place?
      return true; // stops further processing as the cache is clear now
    }
    if (val[prop]?.includes(+id || id)) {
      if (prefix === S_REQUIRE_PRE) {
        val.depsMap[id].forEach(id => cache.del(S_SCRIPT_PRE + id));
      } else {
        cache.del(key); // TODO: try to patch the cache in-place?
      }
    }
  }
}

function onOptionChanged(changes) {
  changes::forEachEntry(([key, value]) => {
    if (OPT_HANDLERS[key]) {
      OPT_HANDLERS[key](value);
    } else if (key.includes('.')) { // used by `expose.url`
      onOptionChanged(objectSet({}, key, value));
    }
  });
}

function togglePreinject(enable) {
  isApplied = enable;
  // Using onSendHeaders because onHeadersReceived in Firefox fires *after* content scripts.
  // And even in Chrome a site may be so fast that preinject on onHeadersReceived won't be useful.
  const onOff = `${enable ? 'add' : 'remove'}Listener`;
  const config = enable ? API_CONFIG : undefined;
  browser.webRequest.onSendHeaders[onOff](onSendHeaders, config);
  if (!isApplied || !xhrInject) { // will be registered in toggleXhrInject
    browser.webRequest.onHeadersReceived[onOff](onHeadersReceived, config);
  }
  browser.tabs.onRemoved[onOff](onTabRemoved);
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
    cache.some(val => {
      if (val[CSAPI_REG]) {
        val[CSAPI_REG].then(reg => reg.unregister());
        delete val[CSAPI_REG];
      }
    });
  } else if (!xhrInject) {
    cache.destroy(); // nuking the cache so that CSAPI_REG is created for subsequent injections
  }
}

function toggleXhrInject(enable) {
  xhrInject = enable;
  cache.destroy();
  browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
  if (enable) {
    browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, API_CONFIG, [
      'blocking',
      kResponseHeaders,
      browser.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS,
    ].filter(Boolean));
  }
}

function onSendHeaders({ url, frameId }) {
  const isTop = !frameId;
  const key = getKey(url, isTop);
  if (!cache.has(key)) prepare(key, url, isTop);
}

/** @param {chrome.webRequest.WebResponseHeadersDetails} info */
function onHeadersReceived(info) {
  const key = getKey(info.url, !info.frameId);
  const bag = xhrInject && cache.get(key);
  // The INJECT data is normally already in cache if code and values aren't huge
  return bag?.[INJECT]?.[SCRIPTS] && prepareXhrBlob(info, bag);
}

/**
 * @param {chrome.webRequest.WebResponseHeadersDetails} info
 * @param {VMInjection.Bag} bag
 */
function prepareXhrBlob({ url, [kResponseHeaders]: responseHeaders, tabId, frameId }, bag) {
  if (IS_FIREFOX && url.startsWith('https:') && detectStrictCsp(responseHeaders)) {
    bag[FORCE_CONTENT] = true;
  }
  triageRealms(bag[INJECT][SCRIPTS], bag[FORCE_CONTENT], tabId, frameId, bag);
  const blobUrl = URL.createObjectURL(new Blob([
    JSON.stringify(bag[INJECT]),
  ]));
  responseHeaders.push({
    name: 'Set-Cookie',
    value: `"${process.env.INIT_FUNC_NAME}"=${blobUrl.split('/').pop()}; SameSite=Lax`,
  });
  setTimeout(URL.revokeObjectURL, 60e3, blobUrl);
  return { [kResponseHeaders]: responseHeaders };
}

function prepare(cacheKey, url, isTop) {
  const shouldExpose = isTop && url.startsWith('https://') && expose[url.split('/', 3)[2]];
  const bagNoOp = shouldExpose ? BAG_NOOP_EXPOSE : BAG_NOOP;
  if (!isApplied) {
    return bagNoOp;
  }
  const errors = [];
  // TODO: teach `getScriptEnv` to skip prepared scripts in cache
  const env = getScriptsByURL(url, isTop, errors);
  if (env) {
    env[PROMISE] = prepareBag(cacheKey, url, isTop,
      env, shouldExpose ? { [EXPOSE]: true } : {}, errors);
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
    [S_CACHE]: env[S_CACHE],
    [SCRIPTS]: prepareScripts(env),
    [INJECT_INTO]: injectInto,
    [MORE]: moreKey,
    [kSessionId]: sessionId,
    [IDS]: allIds,
    clipFF: env.clipFF,
    info: { ua },
    errors: errors.filter(err => allIds[err.split('#').pop()]).join('\n'),
  });
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
  const { require, [RUN_AT]: runAt } = env;
  const code = env[S_CODE][id];
  const dataKey = getUniqId();
  const winKey = getUniqId();
  const key = { data: dataKey, win: winKey };
  const displayName = getScriptName(script);
  const pathMap = custom.pathMap || {};
  const wrap = !meta[UNWRAP];
  const { grant } = meta;
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
    injectedCode.push(`window.${winKey}=function ${dataKey}(`
      // using a shadowed name to avoid scope pollution
      + (grantNone ? GRANT_NONE_VARS : 'GM')
      + (IS_FIREFOX ? `,${dataKey}){try{` : '){')
      + (grantNone ? '' : 'with(this)with(c)delete c,')
      // hiding module interface from @require'd scripts so they don't mistakenly use it
      + '((define,module,exports)=>{');
  }
  for (const url of meta.require) {
    const req = require[pathMap[url] || url];
    if (/\S/.test(req)) {
      injectedCode.push(req, NEWLINE_END_RE.test(req) ? ';' : '\n;');
      hasReqs = true;
    }
  }
  // adding a nested IIFE to support 'use strict' in the code when there are @requires
  if (hasReqs && wrap) {
    injectedCode.push('(()=>{');
  }
  codeIndex = injectedCode.length;
  injectedCode.push(code);
  // adding a new line in case the code ends with a line comment
  injectedCode.push((!NEWLINE_END_RE.test(code) ? '\n' : '')
    + (hasReqs && wrap ? '})()' : '')
    + (wrap ? `})()${IS_FIREFOX ? `}catch(e){${dataKey}(e)}` : ''}}` : '')
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    + (IS_FIREFOX ? ';0' : '')
    + `\n//# sourceURL=${getScriptPrettyUrl(script, displayName)}`);
  return {
    code: '',
    displayName,
    gmi: {
      scriptWillUpdate: !!script.config.shouldUpdate,
      uuid: props.uuid,
    },
    id,
    key,
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
      runAt: `document_${scr[RUN_AT]}`.replace('body', 'start'),
      frameId,
    }).then(scr.meta[UNWRAP] && (() => sendTabCmd(tabId, 'Run', id, { frameId })));
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
    runAt: 'document_start',
  });
}

/** @param {chrome.webRequest.HttpHeader[]} responseHeaders */
function detectStrictCsp(responseHeaders) {
  return responseHeaders.some(({ name, value }) => (
    /^content-security-policy$/i.test(name)
    && /^.(?!.*'unsafe-inline')/.test( // true if not empty and without 'unsafe-inline'
      value.match(/(?:^|;)\s*script-src-elem\s[^;]+/)
      || value.match(/(?:^|;)\s*script-src\s[^;]+/)
      || value.match(/(?:^|;)\s*default-src\s[^;]+/)
      || '',
    )
  ));
}

/** @this {?} truthy = forceContent */
function isPageRealmScript(scr) {
  return !isContentRealm(scr[INJECT_INTO] || normalizeScriptRealm(scr.custom, scr.meta), this);
}

function onTabRemoved(id /* , info */) {
  clearFrameData(id);
}

function onTabReplaced(addedId, removedId) {
  clearFrameData(removedId);
}

function clearFrameData(tabId, frameId) {
  clearRequestsByTabId(tabId, frameId);
  clearValueOpener(tabId, frameId);
}
