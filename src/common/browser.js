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
      if (process.env.DEBUG) promise.catch(err => console.warn(args, err?.message || err));
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
        sendResponse({ error: error instanceof Error ? error.stack : error });
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
    cookies: {
      getAll: wrapAsync,
      getAllCookieStores: wrapAsync,
      set: wrapAsync,
    },
    extension: true,
    i18n: true,
    notifications: {
      onClicked: true,
      onClosed: true,
      clear: wrapAsync,
      create: wrapAsync,
    },
    runtime: {
      connect: true,
      getManifest: true,
      getPlatformInfo: wrapAsync,
      getURL: true,
      openOptionsPage: wrapAsync,
      onConnect: true,
      onMessage: onMessage => ({
        addListener: listener => onMessage.addListener(wrapMessageListener(listener)),
      }),
      sendMessage(sendMessage) {
        const promisifiedSendMessage = wrapAsync(sendMessage);
        const unwrapResponse = ({ data: response, error } = {}) => {
          if (error) throw error;
          return response;
        };
        return data => promisifiedSendMessage(data).then(unwrapResponse);
      },
    },
    storage: {
      local: {
        get: wrapAsync,
        set: wrapAsync,
        remove: wrapAsync,
      },
      onChanged: true,
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
    windows: {
      create: wrapAsync,
      getCurrent: wrapAsync,
      update: wrapAsync,
    },
  };
  global.browser = wrapAPIs(chrome, meta);
} else if (process.env.DEBUG && !global.chrome.app) {
  let counter = 0;
  const { runtime } = global.browser;
  const { sendMessage, onMessage } = runtime;
  const log = (type, args, id, isResponse) => console.info(
    `%c${type}Message#%d${isResponse ? ' response' : ''}`,
    isResponse ? '' : 'color:yellow',
    id,
    ...args,
  );
  runtime.sendMessage = (...args) => {
    counter += 1;
    const id = counter;
    log('send', args, id);
    const promise = runtime::sendMessage(...args);
    promise.then(data => log('send', [data], id, true), console.warn);
    return promise;
  };
  const { addListener } = onMessage;
  onMessage.addListener = (listener) => onMessage::addListener((msg, sender) => {
    counter += 1;
    const id = counter;
    const { frameId, tab, url } = sender;
    log('on', [msg, { frameId, tab, url }], id);
    const result = listener(msg, sender);
    (typeof result?.then === 'function' ? result : Promise.resolve(result))
    .then(data => log('on', [data], id, true), console.warn);
    return result;
  });
}
