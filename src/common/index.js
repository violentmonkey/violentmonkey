/* SAFETY WARNING! Exports used by `injected` must make ::safe() calls,
   when accessed after the initial event loop task in `injected/web`
   or after the first content-mode userscript runs in `injected/content` */

import { browser } from '#/common/consts';
import { deepCopy } from './object';
import { noop } from './util';

export { normalizeKeys } from './object';
export * from './util';

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

// These need `src` parameter so we'll use sendCmd for them. We could have forged `src` via
// browser.tabs.getCurrent but there's no need as they normally use only a tiny amount of data.
const COMMANDS_WITH_SRC = [
  'ConfirmInstall',
  'Notification',
  'TabClose',
  'TabFocus',
  'TabOpen',
  'UpdateValue',
/*
  These are used only by content scripts where sendCmdDirectly can't be used anyway
  'GetInjected',
  'GetRequestId',
  'HttpRequest',
  'InjectionFeedback',
  'SetPopup',
*/
];

/**
 * Sends the command+data directly so it's synchronous and faster than sendCmd thanks to deepCopy.
 * WARNING! Make sure `cmd` handler doesn't use `src` or `cmd` is listed in COMMANDS_WITH_SRC.
 */
export function sendCmdDirectly(cmd, data, options) {
  const bg = !COMMANDS_WITH_SRC.includes(cmd)
    && browser.extension.getBackgroundPage?.();
  return bg && bg !== window && bg.deepCopy
    ? bg.handleCommandMessage(bg.deepCopy({ cmd, data })).then(deepCopy)
    : sendCmd(cmd, data, options);
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
      if (!e.isRuntime) throw e;
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

export function getScriptName(script) {
  return script.custom.name || getLocaleString(script.meta, 'name') || `#${script.props.id}`;
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
