import { getScriptName, getUniqId } from '#/common';
import { INJECT_CONTENT, INJECTABLE_TAB_URL_RE, METABLOCK_RE } from '#/common/consts';
import initCache from '#/common/cache';
import storage from '#/common/storage';
import ua from '#/common/ua';
import { getScriptsByURL } from './db';
import { extensionRoot, postInitialize } from './init';
import { commands } from './message';
import { getOption, hookOptions } from './options';
import { popupTabs } from './popup-tracker';

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
  async onDispose(promise) {
    const data = await promise;
    data.unregister?.();
  },
});
let injectInto;
hookOptions(changes => {
  injectInto = changes.defaultInjectInto ?? injectInto;
  if ('isApplied' in changes) togglePreinject(changes.isApplied);
});
postInitialize.push(() => {
  injectInto = getOption('defaultInjectInto');
  togglePreinject(getOption('isApplied'));
});

Object.assign(commands, {
  InjectionFeedback(feedback, { tab, frameId }) {
    feedback.forEach(([key, needsInjection]) => {
      const code = cacheCode.pop(key);
      // see TIME_KEEP_DATA comment
      if (needsInjection && code) {
        browser.tabs.executeScript(tab.id, {
          code,
          frameId,
          runAt: 'document_start',
        });
      }
    });
  },
});

// Keys of the object returned by getScriptsByURL()
const propsToClear = {
  [storage.cache.prefix]: 'cacheKeys',
  [storage.code.prefix]: true,
  [storage.require.prefix]: 'reqKeys',
  [storage.script.prefix]: true,
  [storage.value.prefix]: 'withValueIds',
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
    clearCache();
  }
});

function clearCache() {
  cacheCode.destroy();
  cache.destroy();
}

/** @return {Promise<Object>} */
export function getInjectedScripts(url, tabId, frameId) {
  return cache.pop(getKey(url, !frameId)) || prepare(url, tabId, frameId, true);
}

function getKey(url, isTop) {
  return isTop ? url : `-${url}`;
}

function togglePreinject(enable) {
  // Using onSendHeaders because onHeadersReceived in Firefox fires *after* content scripts.
  // And even in Chrome a site may be so fast that preinject on onHeadersReceived won't be useful.
  const onOff = `${enable ? 'add' : 'remove'}Listener`;
  const config = enable ? API_CONFIG : undefined;
  browser.webRequest.onSendHeaders[onOff](preinject, config);
  browser.webRequest.onHeadersReceived[onOff](prolong, config);
  clearCache();
}

function preinject({ url, tabId, frameId }) {
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

function prolong({ url, frameId }) {
  cache.hit(getKey(url, !frameId), TIME_AFTER_RECEIVE);
}

async function prepare(url, tabId, frameId, isLate) {
  const data = await getScriptsByURL(url, !frameId);
  const { inject } = data;
  inject.scripts.forEach(prepareScript, data);
  inject.injectInto = injectInto;
  inject.ua = ua;
  inject.isFirefox = ua.isFirefox;
  inject.isPopupShown = popupTabs[tabId];
  if (!isLate && browser.contentScripts) {
    registerScriptDataFF(data, url, !!frameId);
  }
  return data;
}

/** @this data */
function prepareScript(script, index, scripts) {
  const { custom, meta, props } = script;
  const { id } = props;
  const { require, values } = this;
  const code = this.code[id];
  const dataKey = getUniqId('VMin');
  const displayName = getScriptName(script);
  const name = encodeURIComponent(displayName.replace(/[#&',/:;?@=]/g, replaceWithFullWidthForm));
  const isContent = (custom.injectInto || meta.injectInto || injectInto) === INJECT_CONTENT;
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
    // TODO: move code above @require
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
  scripts[index] = {
    ...script,
    dataKey,
    displayName,
    code: isContent ? '' : injectedCode,
    metaStr: code.match(METABLOCK_RE)[1] || '',
    values: values[id],
  };
}

function replaceWithFullWidthForm(s) {
  // fullwidth range starts at 0xFF00, normal range starts at space char code 0x20
  return String.fromCharCode(s.charCodeAt(0) - 0x20 + 0xFF00);
}

const resolveDataCodeStr = `(${(data) => {
  const { vmResolve } = window;
  if (vmResolve) {
    vmResolve(data);
  } else {
    // running earlier than the main content script for whatever reason
    window.vmData = data;
  }
}})`;

function registerScriptDataFF(data, url, allFrames) {
  const promise = browser.contentScripts.register({
    allFrames,
    js: [{
      code: `${resolveDataCodeStr}(${JSON.stringify(data.inject)})`,
    }],
    matches: url.split('#', 1),
    runAt: 'document_start',
  });
  data.unregister = async () => {
    data.unregister = null;
    const r = await promise;
    r.unregister();
  };
}
