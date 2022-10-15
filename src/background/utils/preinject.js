import {
  dataUri2text, getScriptName, getScriptPrettyUrl, getUniqId, sendTabCmd, trueJoin,
} from '@/common';
import {
  INJECT_AUTO, INJECT_CONTENT, INJECT_MAPPING, INJECT_PAGE,
  FEEDBACK, FORCE_CONTENT, METABLOCK_RE, MORE,
} from '@/common/consts';
import initCache from '@/common/cache';
import { forEachEntry, forEachValue, objectPick, objectSet } from '@/common/object';
import ua from '@/common/ua';
import { getScriptsByURL, ENV_CACHE_KEYS, ENV_REQ_KEYS, ENV_SCRIPTS, ENV_VALUE_IDS } from './db';
import { postInitialize } from './init';
import { addPublicCommands } from './message';
import { getOption, hookOptions } from './options';
import { popupTabs } from './popup-tracker';
import { clearRequestsByTabId } from './requests';
import { S_CACHE_PRE, S_CODE_PRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE_PRE } from './storage';
import { clearStorageCache, onStorageChanged } from './storage-cache';
import { addValueOpener, clearValueOpener } from './values';

const API_CONFIG = {
  urls: ['*://*/*'], // `*` scheme matches only http and https
  types: ['main_frame', 'sub_frame'],
};
const CSAPI_REG = 'csar';
const contentScriptsAPI = browser.contentScripts;
/** In normal circumstances the data will be removed in ~1sec on use,
 * however connecting may take a long time or the tab may be paused in devtools. */
const TIME_KEEP_DATA = 5 * 60e3;
const cache = initCache({
  lifetime: TIME_KEEP_DATA,
  async onDispose(val, key) {
    if (!val) return;
    if (val.then) val = await val;
    val[CSAPI_REG]?.then(reg => reg.unregister());
    if ((val = val[INJECT] || val)[ENV_SCRIPTS]) {
      val[ENV_SCRIPTS].forEach(script => cache.del(script.dataKey));
      cache.del(val[MORE] || envStartKey[key]);
      delete envStartKey[key];
    }
  },
});
const extrasCache = initCache({
  lifetime: 3600e3,
});
const NEWLINE_END_RE = /\n((?!\n)\s)*$/;
const SOURCEMAP_RE = /\s*\/\/[#@]\s+source(?:Mapping)?URL=\s*data:application\/json/y;
const INJECT = 'inject';
const INJECT_INTO = 'injectInto';
// KEY_XXX for hooked options
const KEY_EXPOSE = 'expose';
const KEY_DEF_INJECT_INTO = 'defaultInjectInto';
const KEY_IS_APPLIED = 'isApplied';
const KEY_XHR_INJECT = 'xhrInject';
const GRANT_NONE_VARS = '{GM,GM_info,unsafeWindow,cloneInto,createObjectIn,exportFunction}';
const envStartKey = {};
const expose = {};
let isApplied;
let injectInto;
let xhrInject;

addPublicCommands({
  /** @return {Promise<VMInjection>} */
  async GetInjected({ url, forceContent, done }, src) {
    const { frameId, tab } = src;
    const tabId = tab.id;
    if (!url) url = src.url || tab.url;
    clearFrameData(tabId, frameId);
    const key = getKey(url, !frameId);
    const cacheVal = cache.get(key) || prepare(key, url, tabId, frameId, forceContent);
    const bag = cacheVal[INJECT] ? cacheVal : await cacheVal;
    /** @type {VMInjection} */
    const inject = bag[INJECT];
    const feedback = bag[FEEDBACK];
    if (feedback?.length) {
      // Injecting known content scripts without waiting for InjectionFeedback message.
      // Running in a separate task because it may take a long time to serialize data.
      setTimeout(injectionFeedback, 0, { [FEEDBACK]: feedback }, src);
    }
    if (popupTabs[tabId]) {
      setTimeout(sendTabCmd, 0, tabId, 'PopupShown', popupTabs[tabId], { frameId });
    }
    addValueOpener(tabId, frameId, inject[ENV_SCRIPTS]);
    return !done && inject;
  },
  InjectionFeedback: injectionFeedback,
});

hookOptions(onOptionChanged);
postInitialize.push(() => {
  for (const key of [KEY_EXPOSE, KEY_DEF_INJECT_INTO, KEY_IS_APPLIED, KEY_XHR_INJECT]) {
    onOptionChanged({ [key]: getOption(key) });
  }
});

async function injectionFeedback({
  [MORE]: more,
  [FEEDBACK]: feedback,
  [FORCE_CONTENT]: forceContent,
}, src) {
  feedback.forEach(processFeedback, src);
  if (!more) return;
  const env = await cache.get(more);
  if (!env) throw 'Injection data expired, please reload the tab!';
  env[FORCE_CONTENT] = forceContent;
  env[ENV_SCRIPTS].map(prepareScript, env).filter(Boolean).forEach(processFeedback, src);
  addValueOpener(src.tab.id, src.frameId, env[ENV_SCRIPTS]);
  return objectPick(env, ['cache', ENV_SCRIPTS]);
}

/** @this {chrome.runtime.MessageSender} */
async function processFeedback([key, runAt, unwrappedId]) {
  const code = cache.get(key);
  // see TIME_KEEP_DATA comment
  if (runAt && code) {
    const { frameId, tab: { id: tabId } } = this;
    runAt = `document_${runAt === 'body' ? 'start' : runAt}`;
    browser.tabs.executeScript(tabId, { code, frameId, runAt });
    if (unwrappedId) sendTabCmd(tabId, 'Run', unwrappedId, { frameId });
  }
}

const propsToClear = {
  [S_CACHE_PRE]: ENV_CACHE_KEYS,
  [S_CODE_PRE]: true,
  [S_REQUIRE_PRE]: ENV_REQ_KEYS,
  [S_SCRIPT_PRE]: true,
  [S_VALUE_PRE]: ENV_VALUE_IDS,
};

onStorageChanged(({ keys }) => {
  cache.forEach(removeStaleCacheEntry, keys.map((key, i) => [
    key.slice(0, i = key.indexOf(':') + 1),
    key.slice(i),
  ]));
});

/** @this {string[][]} changed storage keys, already split as [prefix,id] */
async function removeStaleCacheEntry(val, key) {
  if (val.then) val = await val;
  if (!val[ENV_CACHE_KEYS]) return;
  for (const [prefix, id] of this) {
    const prop = propsToClear[prefix];
    if (prop === true) {
      cache.destroy(); // TODO: try to patch the cache in-place?
    } else if (val[prop]?.includes(+id || id)) {
      cache.del(key);
    }
  }
}

function normalizeRealm(value) {
  return INJECT_MAPPING::hasOwnProperty(value)
    ? value
    : injectInto || INJECT_AUTO;
}

function onOptionChanged(changes) {
  changes::forEachEntry(([key, value]) => {
    switch (key) {
    case KEY_DEF_INJECT_INTO:
      injectInto = normalizeRealm(value);
      cache.destroy();
      break;
    case KEY_XHR_INJECT:
      toggleXhrInject(value);
      cache.destroy();
      break;
    case KEY_IS_APPLIED:
      togglePreinject(value);
      break;
    case KEY_EXPOSE:
      value::forEachEntry(([site, isExposed]) => {
        expose[decodeURIComponent(site)] = isExposed;
      });
      break;
    default:
      if (key.includes('.')) { // used by `expose.url`
        onOptionChanged(objectSet({}, key, value));
      }
    }
  });
}

function getKey(url, isTop) {
  return isTop ? url : `-${url}`;
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

function toggleXhrInject(enable) {
  xhrInject = enable;
  browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
  if (enable) {
    browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, API_CONFIG, [
      'blocking',
      'responseHeaders',
      browser.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS,
    ].filter(Boolean));
  }
}

function onSendHeaders({ url, tabId, frameId }) {
  const isTop = !frameId;
  const key = getKey(url, isTop);
  if (!cache.has(key)) {
    // GetInjected message will be sent soon by the content script
    // and it may easily happen while getScriptsByURL is still waiting for browser.storage
    // so we'll let GetInjected await this pending data by storing Promise in the cache
    cache.put(key, prepare(key, url, tabId, frameId), TIME_KEEP_DATA);
  }
}

/** @param {chrome.webRequest.WebResponseHeadersDetails} info */
function onHeadersReceived(info) {
  const key = getKey(info.url, !info.frameId);
  const bag = xhrInject && cache.get(key);
  // Proceeding only if prepareScripts has replaced promise in cache with the actual data
  return bag?.[INJECT] && prepareXhrBlob(info, bag);
}

/**
 * @param {chrome.webRequest.WebResponseHeadersDetails} info
 * @param {VMInjection.Bag} bag
 */
function prepareXhrBlob({ url, responseHeaders }, bag) {
  if (IS_FIREFOX && url.startsWith('https:') && detectStrictCsp(responseHeaders)) {
    forceContentInjection(bag);
  }
  const blobUrl = URL.createObjectURL(new Blob([
    JSON.stringify(bag[INJECT]),
  ]));
  responseHeaders.push({
    name: 'Set-Cookie',
    value: `"${process.env.INIT_FUNC_NAME}"=${blobUrl.split('/').pop()}; SameSite=Lax`,
  });
  setTimeout(URL.revokeObjectURL, TIME_KEEP_DATA, blobUrl);
  return { responseHeaders };
}

function prepare(key, url, tabId, frameId, forceContent) {
  /** @type {VMInjection.Bag} */
  const res = {
    [INJECT]: {
      expose: !frameId
        && url.startsWith('https://')
        && expose[url.split('/', 3)[2]],
    },
  };
  return isApplied
    ? prepareScripts(res, key, url, tabId, frameId, forceContent)
    : res;
}

/**
 * @param {VMInjection.Bag} res
 * @param cacheKey
 * @param url
 * @param tabId
 * @param frameId
 * @param forceContent
 * @return {Promise<any>}
 */
async function prepareScripts(res, cacheKey, url, tabId, frameId, forceContent) {
  const errors = [];
  const bag = await getScriptsByURL(url, !frameId, errors);
  const { envDelayed, disabledIds: ids, [ENV_SCRIPTS]: scripts } = bag;
  bag[FORCE_CONTENT] = forceContent; // used in prepareScript and isPageRealm
  propsToClear::forEachValue(val => {
    if (val !== true) res[val] = bag[val];
  });
  cache.batch(true);
  const feedback = scripts.map(prepareScript, bag).filter(Boolean);
  const more = envDelayed.promise;
  const moreKey = more && getUniqId('more');
  /** @type {VMInjection} */
  const inject = res[INJECT];
  Object.assign(inject, {
    [ENV_SCRIPTS]: scripts,
    [INJECT_INTO]: injectInto,
    [INJECT_PAGE]: !forceContent && (
      scripts.some(isPageRealm, bag)
      || envDelayed[ENV_SCRIPTS].some(isPageRealm, bag)
    ),
    [MORE]: moreKey,
    cache: bag.cache,
    ids, // content bridge adds the actually running ids and sends via SetPopup
    info: {
      ua,
    },
    errors: errors.filter(err => !ids.includes(+err.slice(err.lastIndexOf('#') + 1))).join('\n'),
  });
  res[FEEDBACK] = feedback;
  res[CSAPI_REG] = contentScriptsAPI && !xhrInject
    && registerScriptDataFF(inject, url, !!frameId);
  if (more) {
    cache.put(moreKey, more);
    envStartKey[moreKey] = cacheKey;
  }
  cache.put(cacheKey, res); // synchronous onHeadersReceived needs plain object not a Promise
  cache.batch(false);
  return res;
}

/** @this {VMInjection.Env} */
function prepareScript(script) {
  const { custom, meta, props } = script;
  const { id } = props;
  const { [FORCE_CONTENT]: forceContent, require, value } = this;
  const dataKey = getUniqId('VMin');
  const displayName = getScriptName(script);
  const isContent = isContentRealm(script, forceContent);
  const pathMap = custom.pathMap || {};
  // trying to avoid progressive string concatenation of potentially huge code slices
  // adding `;` on a new line in case some required script ends with a line comment
  const [reqsSlices, reqLinesAdded] = meta.require.reduce((accum, url) => {
    const req = require[url = pathMap[url] || url];
    if (req) {
      accum[0].push(req, NEWLINE_END_RE.test(req) ? ';' : '\n;');
      accum[1] += extrasCache.get(url) || extrasCache.put(url, countLines(req));
    }
    return accum;
  }, [[], 0]);
  const [code, metaStr] = patchCode(this.code[id], reqLinesAdded);
  const hasReqs = reqLinesAdded;
  const wrap = !meta.unwrap;
  const { grant } = meta;
  const numGrants = grant.length;
  const grantNone = !numGrants || numGrants === 1 && grant[0] === 'none';
  const injectedCode = [
    wrap && `window.${dataKey}=function(${
      // using a shadowed name to avoid scope pollution
      grantNone ? GRANT_NONE_VARS : 'GM'}${
      IS_FIREFOX ? `,${dataKey}){try{` : '){'}${
      grantNone ? '' : 'with(this)with(c)delete c,'
    // hiding module interface from @require'd scripts so they don't mistakenly use it
    }((define,module,exports)=>{`,
    ...reqsSlices,
    // adding a nested IIFE to support 'use strict' in the code when there are @requires
    hasReqs && wrap && '(()=>{',
    code,
    hasReqs && wrap && '})()',
    wrap && `})()${IS_FIREFOX ? `}catch(e){${dataKey}(e)}` : ''}}`,
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    IS_FIREFOX && ';0',
    `\n//# sourceURL=${getScriptPrettyUrl(script, displayName)}`,
  ]::trueJoin('');
  cache.put(dataKey, injectedCode, TIME_KEEP_DATA);
  /** @type {VMInjection.Script} */
  Object.assign(script, {
    dataKey,
    displayName,
    metaStr,
    // code will be `true` if the desired realm is PAGE which is not injectable
    code: isContent ? '' : forceContent || injectedCode,
    values: value[id] || null,
  });
  return isContent && [
    dataKey,
    script.runAt,
    !wrap && id, // unwrapped scripts need an explicit `Run` message
  ];
}

const resolveDataCodeStr = `(${function _(data) {
  /* `function` is required to compile `this`, and `this` is required because our safe-globals
   * shadows `window` so its name is minified and hence inaccessible here */
  const { vmResolve } = this;
  if (vmResolve) {
    vmResolve(data);
  } else {
    // running earlier than the main content script for whatever reason
    this.vmData = data;
  }
}})`;

// TODO: rework the whole thing to register scripts individually with real `matches`
function registerScriptDataFF(inject, url, allFrames) {
  return contentScriptsAPI.register({
    allFrames,
    js: [{
      code: `${resolveDataCodeStr}(${JSON.stringify(inject)})`,
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

/** @param {VMInjection.Bag} bag */
function forceContentInjection(bag) {
  const inject = bag[INJECT];
  inject[FORCE_CONTENT] = true;
  inject[ENV_SCRIPTS].forEach(scr => {
    // When script wants `page`, the result below will be `true` so the script goes into `failedIds`
    const failed = !isContentRealm(scr, true);
    scr.code = failed || '';
    bag[FEEDBACK].push([
      scr.dataKey,
      !failed && scr.runAt,
      scr.meta.unwrap && scr.props.id,
    ]);
  });
}

function isContentRealm(scr, forceContent) {
  const realm = scr[INJECT_INTO] || (
    scr[INJECT_INTO] = normalizeRealm(scr.custom[INJECT_INTO] || scr.meta[INJECT_INTO])
  );
  return realm === INJECT_CONTENT || forceContent && realm === INJECT_AUTO;
}

/** @this {VMInjection.Env} */
function isPageRealm(scr) {
  return !isContentRealm(scr, this[FORCE_CONTENT]);
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

function countLines(str) {
  if (!str) return 0;
  let res = 1;
  let i = -1;
  while ((i = str.indexOf('\n', i + 1)) >= 0) {
    res += 1;
  }
  return res;
}

function patchCode(code, reqLinesAdded) {
  let m;
  let extras = extrasCache.get(code);
  // remember position of metablock comment
  if (!extras) {
    extras = {};
    if ((m = METABLOCK_RE.exec(code) || [])) {
      extras.m2 = (extras.m1 = m.index) + m[0].length;
    }
  }
  // shift source-mapping data by reqLinesAdded
  if (reqLinesAdded) {
    const i2 = extras.i2 || /\s*$/.exec(code).index;
    let i1 = extras.i1 || Math.max(0, code.lastIndexOf('\n', i2 - 1));
    if (extras.lines !== reqLinesAdded) {
      extras.lines = reqLinesAdded;
      m = extras.map;
      if (!m && (SOURCEMAP_RE.lastIndex = i1, m = SOURCEMAP_RE.exec(code))) {
        i1 += m[0].length;
        try {
          m = JSON.parse(dataUri2text(code.slice(i1, i2)));
          extras.map = m;
          extras.i1 = i1;
          extras.i2 = i2;
        } catch (e) {
          // NOP
        }
      }
      if (m) {
        m = Object.assign({}, m);
        m.mappings = ';'.repeat(reqLinesAdded) + m.mappings;
        extras.url = text2base64(JSON.stringify(m));
      }
    }
    if ((m = extras.url)) {
      code = code.slice(0, i1) + ';charset=utf-8;base64,' + m + code.slice(i2);
    }
  }
  // adding a new line in case the code ends with a line comment
  if (!NEWLINE_END_RE.test(code)) {
    code += '\n';
  }
  extrasCache.put(code, extras);
  return [code, code.slice(extras.m1, extras.m2)];
}

function text2base64(str) {
  if (/[\u0080-\uFFFF]/.test(str)) {
    // TODO: maybe switch blob2base64, which is ~5x faster in Chrome
    const arr = new TextEncoder().encode(str);
    const CHUNK = 8192;
    str = '';
    for (let i = 0; i < arr.length; i += CHUNK) {
      str += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK))
    }
  }
  return btoa(str);
}
