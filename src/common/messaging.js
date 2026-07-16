import browser from './browser';
import { deepCopy } from './object';
import { sendCmdToSW } from './messaging-sw';

export const getBgPage = () => chrome.extension.getBackgroundPage?.();
/** @return {'0' | '1' | ''} treating source as abstract truthy/falsy to ensure consistent result */
const PORT_ERROR_RE = /(Receiving end does not exist)|The message port closed before|moved into back\/forward cache|$/;
/**
 * These need `src` parameter so we'll use sendCmd for them. We could have forged `src` via
 * browser.tabs.getCurrent but there's no need as they normally use only a tiny amount of data.
 */
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

/**
 * @param {string} cmd
 * @param data
 * @param {{retry?: boolean}} [options]
 * @return {Promise | void}
 */
export function sendCmd(cmd, data, options) {
  // Firefox+Vue3 bug workaround for "Proxy object could not be cloned"
  if (!__.MV3 && !__.INJECTED && IS_FIREFOX && global._bg !== 1 && isObject(data)) {
    data = deepCopy(data);
  }
  return sendMessage({ cmd, data }, options);
}

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
