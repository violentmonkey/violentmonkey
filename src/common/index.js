// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

import { browser, extensionRoot, ICON_PREFIX } from '@/common/consts';
import { deepCopy } from './object';
import { blob2base64, i18n, isDataUri } from './util';

export { normalizeKeys } from './object';
export * from './util';

if (process.env.DEV && process.env.IS_INJECTED !== 'injected-web') {
  const get = () => {
    throw 'Do not use `for-of` with Map/Set. Use forEach or for-of with a [...copy]'
    + '\n(not supported due to our config of @babel/plugin-transform-for-of).';
  };
  for (const obj of [Map, Set, WeakMap, WeakSet]) {
    Object.defineProperty(obj.prototype, 'length', { get, configurable: true });
  }
}

export const defaultImage = `${ICON_PREFIX}128.png`;
/** Will be encoded to avoid splitting the URL in devtools UI */
const BAD_URL_CHAR = /[#/?]/g;
/** Fullwidth range starts at 0xFF00, normal range starts at space char code 0x20 */
const replaceWithFullWidthForm = s => String.fromCharCode(s.charCodeAt(0) - 0x20 + 0xFF00);

export function initHooks() {
  const hooks = [];

  function fire(data) {
    hooks.slice().forEach((cb) => {
      cb(data);
    });
  }

  function hook(callback) {
    hooks.push(callback);
    return () => {
      const i = hooks.indexOf(callback);
      if (i >= 0) hooks.splice(i, 1);
    };
  }

  return { hook, fire };
}

/**
 * Used by `injected`
 * @param {string} cmd
 * @param data
 * @param {{retry?: boolean, ignoreError?: boolean}} [options]
 * @return {Promise}
 */
export function sendCmd(cmd, data, options) {
  // Firefox+Vue3 bug workaround for "Proxy object could not be cloned"
  if (!process.env.IS_INJECTED && IS_FIREFOX && isObject(data)) {
    data = deepCopy(data);
  }
  return sendMessage({ cmd, data }, options);
}

// These need `src` parameter so we'll use sendCmd for them. We could have forged `src` via
// browser.tabs.getCurrent but there's no need as they normally use only a tiny amount of data.
const COMMANDS_WITH_SRC = [
  'ConfirmInstall',
  'Notification',
  'TabClose',
  'TabFocus',
  'TabOpen',
/*
  These are used only by content scripts where sendCmdDirectly can't be used anyway
  'GetInjected',
  'GetRequestId',
  'HttpRequest',
  'InjectionFeedback',
  'SetPopup',
*/
];
const getBgPage = () => browser.extension.getBackgroundPage?.();

/**
 * Sends the command+data directly so it's synchronous and faster than sendCmd thanks to deepCopy.
 * WARNING! Make sure `cmd` handler doesn't use `src` or `cmd` is listed in COMMANDS_WITH_SRC.
 */
export function sendCmdDirectly(cmd, data, options, fakeSrc) {
  const bg = !COMMANDS_WITH_SRC.includes(cmd) && getBgPage();
  const bgCopy = bg && bg !== window && bg.deepCopy;
  if (!bgCopy) {
    return sendCmd(cmd, data, options);
  }
  if (fakeSrc) {
    fakeSrc = bgCopy(fakeSrc);
    fakeSrc.fake = true;
  }
  return bg.handleCommandMessage(bgCopy({ cmd, data }), fakeSrc).then(deepCopy);
}

/**
 * @param {number} tabId
 * @param {string} cmd
 * @param data
 * @param {{frameId?: number}} [options]
 * @return {Promise}
 */
export function sendTabCmd(tabId, cmd, data, options) {
  return browser.tabs.sendMessage(tabId, { cmd, data }, options).catch(ignoreNoReceiver);
}

// Used by `injected`
export function sendMessage(payload, { retry } = {}) {
  if (retry) return sendMessageRetry(payload);
  let promise = browser.runtime.sendMessage(payload);
  // Ignoring errors when sending from the extension script because it's a broadcast
  if (!process.env.IS_INJECTED) {
    promise = promise.catch(ignoreNoReceiver);
  }
  return promise;
}

/**
 * Used by `injected`
 * The active tab page and its [content] scripts load before the extension's
 * persistent background script when Chrome starts with a URL via command line
 * or when configured to restore the session, https://crbug.com/314686
 */
export async function sendMessageRetry(payload, retries = 10) {
  let pauseDuration = 10;
  for (; retries > 0; retries -= 1) {
    try {
      const data = await sendMessage(payload);
      if (data !== undefined) {
        return data;
      }
    } catch (e) {
      if (!`${e}`.includes('Could not establish connection.')) {
        throw e;
      }
    }
    await makePause(pauseDuration);
    pauseDuration *= 2;
  }
  throw new Error('Violentmonkey cannot connect to the background page.');
}

export function ignoreNoReceiver(err) {
  if (!/Receiving end does not exist|The message port closed before/.test(err.message)) {
    return Promise.reject(err);
  }
}

export function leftpad(input, length, pad = '0') {
  let num = input.toString();
  while (num.length < length) num = `${pad}${num}`;
  return num;
}

/**
 * Get locale attributes such as `@name:zh-CN`
 */
export function getLocaleString(meta, key) {
  const localeMeta = navigator.languages
  // Use `lang.toLowerCase()` since v2.6.5
  .map(lang => meta[`${key}:${lang}`] || meta[`${key}:${lang.toLowerCase()}`])
  .find(Boolean);
  return localeMeta || meta[key] || '';
}

export function getScriptHome({ custom, meta }) {
  let v = custom.homepageURL || meta.homepageURL || meta.homepage || meta.website || meta.source;
  if (!v) {
    v = meta.namespace;
    v = /^https?:\/\/(?!tampermonkey\.net\/)/.test(v)
      && getFullUrl(v).replace(/^https?(:\/\/userscripts)(\.org\/users\/\w)/, 'https$1-mirror$2');
  }
  return v || '';
}

export function getScriptName(script) {
  return script.custom.name || getLocaleString(script.meta, 'name')
    || `#${script.props.id ?? i18n('labelNoName')}`;
}

/** URL that shows the name of the script and opens in devtools sources or in our editor */
export function getScriptPrettyUrl(script, displayName) {
  return `${
    extensionRoot
  }${
    // When called from prepareScript, adding a space to group scripts in one block visually
    displayName && IS_FIREFOX ? '%20' : ''
  }${
    encodeURIComponent((displayName || getScriptName(script))
    .replace(BAD_URL_CHAR, replaceWithFullWidthForm))
  }.user.js#${
    script.props.id
  }`;
}

/**
 * @param {VMScript} script
 * @param {boolean} [all] - to return all two urls (1: check, 2: download)
 * @return {Array<string>|string|void}
 */
export function getScriptUpdateUrl(script, all) {
  if (script.config.shouldUpdate) {
    const { custom, meta } = script;
    const downloadURL = custom.downloadURL || meta.downloadURL || custom.lastInstallURL;
    const updateURL = custom.updateURL || meta.updateURL || downloadURL;
    const url = downloadURL || updateURL;
    if (url) return all ? [downloadURL, updateURL] : url;
  }
}

export function getFullUrl(url, base) {
  let obj;
  try {
    obj = new URL(url, base);
  } catch (e) {
    return `data:,${e.message} ${url}`;
  }
  // Use protocol whitelist to filter URLs
  if (![
    'http:',
    'https:',
    'ftp:',
    'data:',
  ].includes(obj.protocol)) obj.protocol = 'http:';
  return obj.href;
}

export function encodeFilename(name) {
  // `escape` generated URI has % in it
  return name.replace(/[-\\/:*?"<>|%\s]/g, (m) => {
    let code = m.charCodeAt(0).toString(16);
    if (code.length < 2) code = `0${code}`;
    return `-${code}`;
  });
}

export function decodeFilename(filename) {
  return filename.replace(/-([0-9a-f]{2})/g, (_m, g) => String.fromCharCode(parseInt(g, 16)));
}

export async function getActiveTab() {
  return (
    await browser.tabs.query({
      active: true,
      currentWindow: true,
    })
  )[0] || (
    // Chrome bug workaround when an undocked devtools window is focused
    await browser.tabs.query({
      active: true,
      windowId: (await browser.windows.getCurrent()).id,
    })
  )[0];
}

export function makePause(ms) {
  return ms < 0
    ? Promise.resolve()
    : new Promise(resolve => setTimeout(resolve, ms));
}

export function trueJoin(separator) {
  return this.filter(Boolean).join(separator);
}

/**
 * @param {string} url
 * @param {string} raw - raw value in storage.cache
 * @returns {?string}
 */
export function makeDataUri(raw, url) {
  if (isDataUri(url)) return url;
  if (/^(i,|image\/)/.test(raw)) { // workaround for bugs in old VM, see 2e135cf7
    const i = raw.lastIndexOf(',');
    const type = raw.startsWith('image/') ? raw.slice(0, i) : 'image/png';
    return `data:${type};base64,${raw.slice(i + 1)}`;
  }
  return raw;
}

/**
 * @param {VMReq.Response} response
 * @param {boolean} [noJoin]
 * @returns {string|string[]}
 */
export async function makeRaw(response, noJoin) {
  const type = (response.headers.get('content-type') || '').split(';')[0] || '';
  const body = await blob2base64(response.data);
  return noJoin ? [type, body] : `${type},${body}`;
}
