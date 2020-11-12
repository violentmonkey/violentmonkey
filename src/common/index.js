import { browser } from '#/common/consts';
import { noop } from './util';

export { normalizeKeys } from './object';
export * from './util';

export function i18n(name, args) {
  return browser.i18n.getMessage(name, args) || name;
}
export const defaultImage = '/public/images/icon128.png';

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
 * @param {string} cmd
 * @param data
 * @param {{retry?: boolean, ignoreError?: boolean}} [options]
 * @return {Promise}
 */
export function sendCmd(cmd, data, options) {
  return sendMessage({ cmd, data }, options);
}

/**
 * @param {number} tabId
 * @param {string} cmd
 * @param data
 * @param {{frameId?: number}} [options]
 * @return {Promise}
 */
export function sendTabCmd(tabId, cmd, data, options) {
  return browser.tabs.sendMessage(tabId, { cmd, data }, options).catch(noop);
}

// ignoreError is always `true` when sending from the background script because it's a broadcast
export function sendMessage(payload, { retry, ignoreError } = {}) {
  if (retry) return sendMessageRetry(payload);
  let promise = browser.runtime.sendMessage(payload);
  if (ignoreError || window === browser.extension.getBackgroundPage?.()) {
    promise = promise.catch(noop);
  }
  return promise;
}

/**
 * The active tab page and its [content] scripts load before the extension's
 * persistent background script when Chrome starts with a URL via command line
 * or when configured to restore the session, https://crbug.com/314686
 */
export async function sendMessageRetry(payload, retries = 10) {
  let pauseDuration = 10;
  for (; retries > 0; retries -= 1) {
    try {
      const data = await sendMessage(payload);
      if (data) return data;
    } catch (e) {
      if (typeof e === 'string') throw e; // not a connection error which is an object
    }
    await makePause(pauseDuration);
    pauseDuration *= 2;
  }
  throw new Error('Violentmonkey cannot connect to the background page.');
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

export function getFullUrl(url, base) {
  const obj = new URL(url, base);
  // Use protocol whitelist to filter URLs
  if (![
    'http:',
    'https:',
    'ftp:',
    'data:',
  ].includes(obj.protocol)) obj.protocol = 'http:';
  return obj.href;
}

export function isRemote(url) {
  return url && !(/^(file:|data:|https?:\/\/localhost[:/]|http:\/\/127\.0\.0\.1[:/])/.test(url));
}

export function cache2blobUrl(raw, { defaultType, type: overrideType } = {}) {
  if (raw) {
    const parts = `${raw}`.split(',');
    const { length } = parts;
    const b64 = parts[length - 1];
    const type = overrideType || parts[length - 2] || defaultType || '';
    // Binary string is not supported by blob constructor,
    // so we have to transform it into array buffer.
    const bin = window.atob(b64);
    const arr = new window.Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type });
    return URL.createObjectURL(blob);
  }
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
  const [tab] = await browser.tabs.query({
    active: true,
    windowId: -2, // chrome.windows.WINDOW_ID_CURRENT works when debugging the popup in devtools
  });
  return tab;
}

export function makePause(ms) {
  return ms < 0
    ? Promise.resolve()
    : new Promise(resolve => setTimeout(resolve, ms));
}

export function trueJoin(separator) {
  return this.filter(Boolean).join(separator);
}
