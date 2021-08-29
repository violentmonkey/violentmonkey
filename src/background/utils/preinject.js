import { getScriptName, getUniqId, hasOwnProperty } from '#/common';
import {
  INJECT_AUTO, INJECT_CONTENT, INJECT_MAPPING, INJECTABLE_TAB_URL_RE, METABLOCK_RE,
} from '#/common/consts';
import initCache from '#/common/cache';
import { forEachEntry, objectSet } from '#/common/object';
import storage from '#/common/storage';
import ua from '#/common/ua';
import { getScriptsByURL, ENV_CACHE_KEYS, ENV_REQ_KEYS, ENV_VALUE_IDS } from './db';
import { extensionRoot, postInitialize } from './init';
import { commands } from './message';
import { getOption, hookOptions } from './options';

const API_CONFIG = {
  urls: ['*://*/*'], // `*` scheme matches only http and https
  types: ['main_frame', 'sub_frame'],
};
const TIME_AFTER_SEND = 10e3; // longer as establishing connection to sites may take time
const TIME_AFTER_RECEIVE = 1e3; // shorter as response body will be coming very soon
const TIME_KEEP_DATA = 60e3; // 100ms should be enough but the tab may hang or get paused in debugger
const cacheCode = initCache({ lifetime: TIME_KEEP_DATA });
const cache = initCache({
  lifetime: TIME_KEEP_DATA,
  onDispose: async promise => (await promise).rcsPromise?.unregister(),
});
const KEY_EXPOSE = 'expose';
const KEY_INJECT_INTO = 'defaultInjectInto';
const KEY_IS_APPLIED = 'isApplied';
const expose = {};
let isApplied;
let injectInto;
hookOptions(onOptionChanged);
postInitialize.push(() => {
  for (const key of [KEY_EXPOSE, KEY_INJECT_INTO, KEY_IS_APPLIED]) {
    onOptionChanged({ [key]: getOption(key) });
  }
});

Object.assign(commands, {
  async InjectionFeedback({ feedId, feedback, pageInjectable }, src) {
    feedback.forEach(processFeedback, src);
    if (feedId) {
      const env = await cache.pop(feedId);
      if (env) {
        const { scripts } = env;
        env.forceContent = !pageInjectable;
        scripts.map(prepareScript, env).filter(Boolean).forEach(processFeedback, src);
        return {
          info: { cache: env.cache },
          scripts,
        };
      }
    }
  },
});

/** @this {chrome.runtime.MessageSender} */
function processFeedback([key, needsInjection]) {
  const code = cacheCode.pop(key);
  // see TIME_KEEP_DATA comment
  if (needsInjection && code) {
    browser.tabs.executeScript(this.tab.id, {
      code,
      frameId: this.frameId,
      runAt: 'document_start',
    });
  }
}

const propsToClear = {
  [storage.cache.prefix]: ENV_CACHE_KEYS,
  [storage.code.prefix]: true,
  [storage.require.prefix]: ENV_REQ_KEYS,
  [storage.script.prefix]: true,
  [storage.value.prefix]: ENV_VALUE_IDS,
};

browser.storage.onChanged.addListener(async changes => {
  const dbKeys = Object.keys(changes);
  const cacheValues = await Promise.all(cache.getValues());
  const dirty = cacheValues.some(data => data.inject
    && dbKeys.some((key) => {
      const prefix = key.slice(0, key.indexOf(':') + 1);
      const prop = propsToClear[prefix];
      key = key.slice(prefix.length);
      return prop === true
        || data[prop]?.includes(prefix === storage.value.prefix ? +key : key);
    }));
  if (dirty) {
    cache.destroy();
  }
});

function normalizeInjectInto(value) {
  return INJECT_MAPPING::hasOwnProperty(value)
    ? value
    : injectInto || INJECT_AUTO;
}

function onOptionChanged(changes) {
  changes::forEachEntry(([key, value]) => {
    switch (key) {
    case KEY_INJECT_INTO:
      injectInto = normalizeInjectInto(value);
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

/** @return {Promise<Object>} */
export function getInjectedScripts(url, tabId, frameId) {
  return cache.pop(getKey(url, !frameId)) || prepare(url, tabId, frameId, true);
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
  browser.webRequest.onHeadersReceived[onOff](onHeadersReceived, config);
  cache.destroy();
}

function onSendHeaders({ url, tabId, frameId }) {
  if (!INJECTABLE_TAB_URL_RE.test(url)) return;
  const isTop = !frameId;
  const key = getKey(url, isTop);
  if (!cache.has(key)) {
    // GetInjected message will be sent soon by the content script
    // and it may easily happen while getScriptsByURL is still waiting for browser.storage
    // so we'll let GetInjected await this pending data by storing Promise in the cache
    cache.put(key, prepare(url, tabId, frameId), TIME_AFTER_SEND);
  }
}

/** @param {chrome.webRequest.WebResponseHeadersDetails} info */
function onHeadersReceived(info) {
  cache.hit(getKey(info.url, !info.frameId), TIME_AFTER_RECEIVE);
}

function prepare(url, tabId, frameId, isLate) {
  /** @namespace VMGetInjectedData */
  const res = {
    expose: !frameId
      && url.startsWith('https://')
      && expose[url.split('/', 3)[2]],
  };
  return isApplied
    ? prepareScripts(url, tabId, frameId, isLate, res)
    : res;
}

async function prepareScripts(url, tabId, frameId, isLate, res) {
  const data = await getScriptsByURL(url, !frameId);
  const { envDelayed, scripts } = data;
  const feedback = scripts.map(prepareScript, data).filter(Boolean);
  const more = envDelayed.promise;
  const feedId = getUniqId(`${tabId}:${frameId}:`);
  /** @namespace VMGetInjectedData */
  Object.assign(res, {
    feedId, // InjectionFeedback id for envDelayed
    injectInto,
    scripts,
    hasMore: !!more, // tells content bridge to expect envDelayed
    ids: data.disabledIds, // content bridge adds the actually running ids and sends via SetPopup
    info: {
      cache: data.cache,
      isFirefox: ua.isFirefox,
      ua,
    },
  });
  Object.defineProperty(res, '_tmp', {
    value: {
      feedback,
      valOpIds: [...data[ENV_VALUE_IDS], ...envDelayed[ENV_VALUE_IDS]],
    },
  });
  if (!isLate && browser.contentScripts) {
    registerScriptDataFF(data, res, url, !!frameId);
  }
  if (more) cache.put(feedId, more);
  return res;
}

/** @this {VMScriptByUrlData} */
function prepareScript(script) {
  const { custom, meta, props } = script;
  const { id } = props;
  const { forceContent, require, value } = this;
  const code = this.code[id];
  const dataKey = getUniqId('VMin');
  const displayName = getScriptName(script);
  const name = encodeURIComponent(displayName.replace(/[#&',/:;?@=+]/g, replaceWithFullWidthForm));
  const realm = normalizeInjectInto(custom.injectInto || meta.injectInto);
  const isContent = realm === INJECT_CONTENT || forceContent && realm === INJECT_AUTO;
  const pathMap = custom.pathMap || {};
  const reqs = meta.require?.map(key => require[pathMap[key] || key]).filter(Boolean);
  // trying to avoid progressive string concatenation of potentially huge code slices
  // adding `;` on a new line in case some required script ends with a line comment
  const reqsSlices = reqs ? [].concat(...reqs.map(req => [req, '\n;'])) : [];
  const hasReqs = reqsSlices.length;
  const injectedCode = [
    // hiding module interface from @require'd scripts so they don't mistakenly use it
    `window.${dataKey}=function(${dataKey}){try{with(this)((define,module,exports)=>{`,
    ...reqsSlices,
    // adding a nested IIFE to support 'use strict' in the code when there are @requires
    hasReqs ? '(()=>{' : '',
    code,
    // adding a new line in case the code ends with a line comment
    code.endsWith('\n') ? '' : '\n',
    hasReqs ? '})()' : '',
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    `})()}catch(e){${dataKey}(e)}};0`,
    // Firefox lists .user.js among our own content scripts so a space at start will group them
    `\n//# sourceURL=${extensionRoot}${ua.isFirefox ? '%20' : ''}${name}.user.js#${id}`,
  ].join('');
  cacheCode.put(dataKey, injectedCode, TIME_KEEP_DATA);
  /** @namespace VMInjectedScript */
  Object.assign(script, {
    dataKey,
    displayName,
    // code will be `true` if the desired realm is PAGE which is not injectable
    code: isContent ? '' : forceContent || injectedCode,
    injectInto: realm,
    metaStr: code.match(METABLOCK_RE)[1] || '',
    values: value[id],
  });
  return isContent && [dataKey, true];
}

function replaceWithFullWidthForm(s) {
  // fullwidth range starts at 0xFF00, normal range starts at space char code 0x20
  return String.fromCharCode(s.charCodeAt(0) - 0x20 + 0xFF00);
}

const resolveDataCodeStr = `(${(data) => {
  // not using `window` because this code can't reach its replacement set by guardGlobals
  const { vmResolve } = this;
  if (vmResolve) {
    vmResolve(data);
  } else {
    // running earlier than the main content script for whatever reason
    this.vmData = data;
  }
}})`;

// TODO: rework the whole thing to register scripts individually with real `matches`
function registerScriptDataFF(data, inject, url, allFrames) {
  data::forEachEntry(([key]) => delete data[key]); // releasing the contents for garbage collection
  data.rcsPromise = browser.contentScripts.register({
    allFrames,
    js: [{
      code: `${resolveDataCodeStr}(${JSON.stringify(inject)})`,
    }],
    matches: url.split('#', 1),
    runAt: 'document_start',
  });
}
