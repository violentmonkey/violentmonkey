// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

import browser from './browser';
import { deepCopy } from './object';
import { noop } from './util';
import { sendCmdToSW } from './sw-messaging';

export { normalizeKeys } from './object';
export * from './script';
export * from './string';
export * from './util';

export const ignoreChromeErrors = () => chrome.runtime.lastError;
export const browserWindows = !__.INJECTED && browser.windows;
export const defaultImage = !__.INJECTED && `${ICON_PREFIX}128.png`;
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
  if (!__.MV3 && !__.INJECTED && IS_FIREFOX && global._bg !== 1 && isObject(data)) {
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
  if (__.MV3) {
    return COMMANDS_WITH_SRC.includes(cmd)
      ? sendCmd(cmd, data, options)
      : sendCmdToSW(cmd, data, fakeSrc && {...fakeSrc, fake: true});
  }
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
  if (!__.INJECTED) {
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
    if (!__.MV3) await browser.storage.local.get(VIOLENTMONKEY);
  }
  throw new Error(VIOLENTMONKEY + ' cannot connect to the background page.');
}

export function ignoreNoReceiver(err) {
  if (!PORT_ERROR_RE.exec(err)[0]) {
    return Promise.reject(err);
  }
}

/** @return {chrome.tabs.Tab | void} */
export function getTab(tabId) {
  return browser.tabs.get(tabId).catch(noop);
}

/** @return {Promise<chrome.tabs.Tab | void>} */
export async function getActiveTab(windowId = -2 /*chrome.windows.WINDOW_ID_CURRENT*/) {
  let [res] = await browser.tabs.query({ active: true, [kWindowId]: windowId });
  // Chrome bug workaround when an undocked devtools window is focused
  if (!res && browserWindows && (res = await browserWindows.getCurrent().catch(noop))) {
    [res] = await browser.tabs.query({ active: true, [kWindowId]: res.id });
  }
  return res;
}

let keepAliveChain, keepAliveTimer;

/**
 * @template T
 * @param {T} [promise]
 * @return {T | ((v?: any) => void)} original promise or a new promise's resolver
 */
export function keepAlive(promise) {
  let res = promise;
  if (!res) ({promise, resolve: res} = Promise.withResolvers());
  const chain = keepAliveChain = keepAliveChain ? keepAliveChain.finally(() => promise) : promise;
  keepAliveChain.finally(() => {
    if (keepAliveChain === chain) {
      clearInterval(keepAliveTimer);
      keepAliveChain = keepAliveTimer = 0;
    }
  });
  keepAliveTimer ||= setInterval(chrome.runtime.getPlatformInfo, 25e3);
  return res;
}

/**
 * @template T
 * @param {number} [ms]
 * @param {T} [arg] - resolved value of the Promise
 * @return {Promise<T>}
 */
export function makePause(ms, arg) {
  const res = ms < 0
    ? Promise.resolve(arg)
    : new Promise(resolve => setTimeout(resolve, ms, arg));
  return __.SW && ms > 0 ? keepAlive(res) : res;
}
