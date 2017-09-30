import 'src/common/polyfills';

/* global chrome */
const globalObj = typeof global !== 'undefined' ? global : window;

function wrapAsync(func, thisObj) {
  return (...args) => {
    const promise = new Promise((resolve, reject) => {
      args.push(res => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
      func.apply(thisObj, args);
    });
    promise.catch(err => {
      if (process.env.DEBUG) console.warn(args, err);
    });
    return promise;
  };
}
function wrapAPIs(source, meta) {
  const target = {};
  Object.keys(source).forEach(key => {
    const metaVal = meta && meta[key];
    if (metaVal) {
      const value = source[key];
      if (typeof metaVal === 'function') {
        target[key] = metaVal(value, source);
      } else if (typeof metaVal === 'object' && typeof value === 'object') {
        target[key] = wrapAPIs(value, metaVal);
      } else {
        target[key] = value;
      }
    }
  });
  return target;
}
const meta = {
  browserAction: true,
  i18n: true,
  notifications: {
    onClicked: true,
    onClosed: true,
    create: wrapAsync,
  },
  runtime: {
    getManifest: true,
    getURL: true,
    openOptionsPage: wrapAsync,
    onMessage(onMessage) {
      function wrapListener(listener) {
        return function onChromeMessage(message, sender, sendResponse) {
          if (process.env.DEBUG) {
            console.info('receive', message);
          }
          const result = listener(message, sender);
          if (result && typeof result.then === 'function') {
            result.then(data => {
              if (process.env.DEBUG) {
                console.info('send', data);
              }
              sendResponse({ data });
            }, error => {
              if (process.env.DEBUG) console.warn(error);
              sendResponse({ error });
            })
            .catch(() => {
              // Ignore sendResponse error
            });
            return true;
          } else if (typeof result !== 'undefined') {
            // In some browsers (e.g Chrome 56, Vivaldi), the listener in
            // popup pages are not properly cleared after closed.
            // They may send `undefined` before the real response is sent.
            sendResponse({ data: result });
          }
        };
      }
      return {
        addListener(listener) {
          return onMessage.addListener(wrapListener(listener));
        },
      };
    },
    sendMessage(sendMessage) {
      const promisifiedSendMessage = wrapAsync(sendMessage);
      return data => {
        const promise = promisifiedSendMessage(data)
        .then(res => {
          if (res && res.error) throw res.error;
          return res && res.data;
        });
        promise.catch(err => {
          if (process.env.DEBUG) console.warn(err);
        });
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
    onUpdated: true,
    onRemoved: true,
    create: wrapAsync,
    get: wrapAsync,
    query: wrapAsync,
    reload: wrapAsync,
    remove: wrapAsync,
    sendMessage: wrapAsync,
    update: wrapAsync,
  },
  webRequest: true,
};
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  globalObj.browser = wrapAPIs(chrome, meta);
  globalObj.browser.__patched = true;
}
