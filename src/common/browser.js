// Since this also runs in a content script we'll guard against implicit global variables
// for DOM elements with 'id' attribute which is a standard feature, more info:
// https://github.com/mozilla/webextension-polyfill/pull/153
// https://html.spec.whatwg.org/multipage/window-object.html#named-access-on-the-window-object
if (!global.browser?.runtime?.sendMessage) {
  const { chrome, Promise } = global;
  const wrapAPIs = (source, meta = {}) => {
    return Object.entries(source)
    .reduce((target, [key, value]) => {
      const metaVal = meta[key];
      if (metaVal) {
        if (typeof metaVal === 'function') {
          value = source::metaVal(value);
        } else if (typeof metaVal === 'object' && typeof value === 'object') {
          value = wrapAPIs(value, metaVal);
        }
        target[key] = value;
      }
      return target;
    }, {});
  };
  const wrapAsync = function wrapAsync(func) {
    return (...args) => {
      const promise = new Promise((resolve, reject) => {
        this::func(...args, (res) => {
          const err = chrome.runtime.lastError;
          if (err) reject(err);
          else resolve(res);
        });
      });
      if (process.env.DEBUG) promise.catch(err => console.warn(args, err));
      return promise;
    };
  };
  const wrapMessageListener = listener => (message, sender, sendResponse) => {
    if (process.env.DEBUG) console.info('receive', message);
    const result = listener(message, sender);
    if (typeof result?.then === 'function') {
      result.then((data) => {
        if (process.env.DEBUG) console.info('send', data);
        sendResponse({ data });
      }, (error) => {
        if (process.env.DEBUG) console.warn(error);
        sendResponse({ error });
      })
      .catch(() => {}); // Ignore sendResponse error
      return true;
    }
    if (typeof result !== 'undefined') {
      // In some browsers (e.g Chrome 56, Vivaldi), the listener in
      // popup pages are not properly cleared after closed.
      // They may send `undefined` before the real response is sent.
      sendResponse({ data: result });
    }
  };
  const meta = {
    browserAction: true,
    commands: true,
    cookies: true,
    extension: true,
    i18n: true,
    notifications: {
      onClicked: true,
      onClosed: true,
      create: wrapAsync,
    },
    runtime: {
      getManifest: true,
      getPlatformInfo: wrapAsync,
      getURL: true,
      openOptionsPage: wrapAsync,
      onMessage: onMessage => ({
        addListener: listener => onMessage.addListener(wrapMessageListener(listener)),
      }),
      sendMessage(sendMessage) {
        const promisifiedSendMessage = wrapAsync(sendMessage);
        const unwrapResponse = ({ data: response, error } = {}) => {
          if (error) throw error;
          return response;
        };
        return (data) => {
          const promise = promisifiedSendMessage(data).then(unwrapResponse);
          if (process.env.DEBUG) promise.catch(console.warn);
          return promise;
        };
      },
    },
    storage: {
      local: {
        get: wrapAsync,
        set: wrapAsync,
        remove: wrapAsync,
      },
    },
    tabs: {
      onCreated: true,
      onUpdated: true,
      onRemoved: true,
      onReplaced: true,
      create: wrapAsync,
      get: wrapAsync,
      query: wrapAsync,
      reload: wrapAsync,
      remove: wrapAsync,
      sendMessage: wrapAsync,
      update: wrapAsync,
      executeScript: wrapAsync,
    },
    webRequest: true,
  };
  global.browser = wrapAPIs(chrome, meta);
}
// prefetch the options while the current extension page loads
/* global browser */
if (browser.tabs) {
  global.allOptions = browser.runtime.sendMessage({ cmd: 'GetAllOptions' })
  .then(({ data }) => data)
  .catch(() => {});
}
