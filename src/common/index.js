// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

import { browser } from './consts';
import { deepCopy } from './object';

export { normalizeKeys } from './object';
export * from './script';
export * from './string';
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

export const ignoreChromeErrors = () => chrome.runtime.lastError;
export const browserWindows = !process.env.IS_INJECTED && browser.windows;
export const defaultImage = !process.env.IS_INJECTED && `${ICON_PREFIX}128.png`;
/** @return {'0' | '1' | ''} treating source as abstract truthy/falsy to ensure consistent result */
const PORT_ERROR_RE = /(Receiving end does not exist)|The message port closed before|moved into back\/forward cache|$/;

export function initHooks() {
  const hooks = new Set();
  return {
    hook(cb) {
      hooks.add(cb);
      return () => hooks.delete(cb);
    },
    fire(...data) {
      // Set#forEach correctly iterates the remainder even if current callback unhooks itself
      hooks.forEach(cb => cb(...data));
    },
  };
}

/**
 * @param {string} cmd
 * @param data
 * @param {{retry?: boolean}} [options]
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
export const getBgPage = () => browser.extension.getBackgroundPage?.();

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
 * @param {VMMessageTargetFrame} [options]
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
export async function sendMessageRetry(payload, maxDuration = 10e3) {
  for (let start = performance.now(); performance.now() - start < maxDuration;) {
    try {
      const data = await sendMessage(payload);
      if (data !== undefined) {
        return data;
      }
    } catch (e) {
      if (!PORT_ERROR_RE.exec(e)[1]) {
        throw e;
      }
    }
    // Not using setTimeout which may be cleared by the web page
    await browser.storage.local.get(VIOLENTMONKEY);
  }
  throw new Error(VIOLENTMONKEY + ' cannot connect to the background page.');
}

export function ignoreNoReceiver(err) {
  if (!PORT_ERROR_RE.exec(err)[0]) {
    return Promise.reject(err);
  }
}

export async function getActiveTab(windowId = -2 /*chrome.windows.WINDOW_ID_CURRENT*/) {
  return (
    await browser.tabs.query({
      active: true,
      [kWindowId]: windowId,
    })
  )[0] || browserWindows && (
    // Chrome bug workaround when an undocked devtools window is focused
    await browser.tabs.query({
      active: true,
      [kWindowId]: (await browserWindows.getCurrent()).id,
    })
  )[0];
}

export function makePause(ms) {
  return ms < 0
    ? Promise.resolve()
    : new Promise(resolve => setTimeout(resolve, ms));
}
