// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

import browser from './browser';
import { noop } from './util';

export { normalizeKeys } from './object';
export * from './messaging';
export * from './script';
export * from './string';
export * from './util';

export const ignoreChromeErrors = () => chrome.runtime.lastError;
export const browserWindows = !__.INJECTED && browser.windows;
export const defaultImage = !__.INJECTED && `${ICON_PREFIX}128.png`;

/** @return {string} */
export const getUUID = __.MV3 || crypto.randomUUID ? crypto.randomUUID.bind(crypto) : () => {
  const rnd = new Uint16Array(8);
  crypto.getRandomValues(rnd);
  // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We're using UUIDv4 variant 1 so N=4 and M=8
  // See format_uuid_v3or5 in https://tools.ietf.org/rfc/rfc4122.txt
  rnd[3] = rnd[3] & 0x0FFF | 0x4000; // eslint-disable-line no-bitwise
  rnd[4] = rnd[4] & 0x3FFF | 0x8000; // eslint-disable-line no-bitwise
  return '01-2-3-4-567'.replace(/\d/g, i => (rnd[i] + 0x1_0000).toString(16).slice(-4));
};

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

/** @return {chrome.tabs.Tab | void} */
export function getTab(tabId) {
  return browser.tabs.get(tabId).catch(noop);
}

/** @return {Promise<chrome.tabs.Tab | void>} */
export async function getActiveTab(windowId) {
  let res = { active: true };
  if (windowId != null) res[kWindowId] = windowId; // not supported in Kiwi
  else res.currentWindow = true;
  [res] = await browser.tabs.query(res);
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
