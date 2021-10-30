// Since this also runs in a content script we'll guard against implicit global variables
// for DOM elements with 'id' attribute which is a standard feature, more info:
// https://github.com/mozilla/webextension-polyfill/pull/153
// https://html.spec.whatwg.org/multipage/window-object.html#named-access-on-the-window-object
if (!IS_FIREFOX && !global.browser?.runtime) {
  // region Chrome
  const { chrome, Proxy: ProxySafe } = global;
  const { apply, bind } = ProxySafe;
  const MESSAGE = 'message';
  const STACK = 'stack';
  const isSyncMethodName = key => key === 'addListener'
    || key === 'removeListener'
    || key === 'hasListener'
    || key === 'hasListeners';
  /** API types or enums or literal constants */
  const isFunction = val => typeof val === 'function';
  const isObject = val => typeof val === 'object';
  const proxifyValue = (target, key, src, metaVal) => {
    const srcVal = src[key];
    if (srcVal === undefined) return;
    let res;
    if (isFunction(metaVal)) {
      res = metaVal(src, srcVal);
    } else if (isFunction(srcVal)) {
      res = metaVal === 0 || isSyncMethodName(key) || !src::hasOwnProperty(key)
        ? srcVal::bind(src)
        : wrapAsync(src, srcVal); // eslint-disable-line no-use-before-define
    } else if (isObject(srcVal) && metaVal !== 0) {
      res = proxifyGroup(srcVal, metaVal); // eslint-disable-line no-use-before-define
    } else {
      res = srcVal;
    }
    target[key] = res;
    return res;
  };
  const proxifyGroup = (src, meta) => new ProxySafe({}, {
    get: (group, key) => group[key] ?? proxifyValue(group, key, src, meta?.[key]),
  });
  /**
   * @param {Object} thisArg - original API group
   * @param {function} func - original API function
   * @param {WrapAsyncPreprocessorFunc} [preprocessorFunc] - modifies the API callback's response
    */
  const wrapAsync = (thisArg, func, preprocessorFunc) => (
    (...args) => {
      let resolve;
      let reject;
      /* Using resolve/reject to call API in the scope of this function, not inside Promise,
         because an API validation exception is thrown synchronously both in Chrome and FF
         so the caller can use try/catch to detect it like we've been doing in icon.js */
      const promise = new PromiseSafe((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
      });
      // Make the error messages actually useful by capturing a real stack
      const stackInfo = new ErrorSafe(`callstack before invoking ${func.name || 'chrome API'}:`);
      // A single parameter `result` is fine because we don't use API that return more
      args[args.length] = result => {
        const runtimeErr = chrome.runtime.lastError;
        const err = runtimeErr || (
          preprocessorFunc
            ? preprocessorFunc(resolve, result)
            : resolve(result)
        );
        // Prefer `reject` over `throw` which stops debugger in 'pause on exceptions' mode
        if (err) {
          if (!runtimeErr) stackInfo[STACK] = `${err[1]}\n${stackInfo[STACK]}`;
          stackInfo[MESSAGE] = runtimeErr ? err[MESSAGE] : `${err[0]}`;
          stackInfo.isRuntime = !!runtimeErr;
          reject(stackInfo);
        }
      };
      func::apply(thisArg, args);
      if (process.env.DEBUG) promise.catch(err => console.warn(args, err?.[MESSAGE] || err));
      return promise;
    }
  );
  // Both result and error must be explicitly specified to avoid prototype eavesdropping
  const wrapSuccess = result => [
    result,
    null,
  ];
  // Both result and error must be explicitly specified to avoid prototype eavesdropping
  const wrapError = err => process.env.DEBUG && console.warn(err) || [
    null,
    err instanceof ErrorSafe
      ? [err[MESSAGE], err[STACK]]
      : [err, ''],
  ];
  const sendResponseAsync = async (result, sendResponse) => {
    try {
      result = await result;
      if (process.env.DEBUG) console.info('send', result);
      sendResponse(wrapSuccess(result));
    } catch (err) {
      sendResponse(wrapError(err));
    }
  };
  const onMessageListener = (listener, message, sender, sendResponse) => {
    if (process.env.DEBUG) console.info('receive', message);
    try {
      const result = listener(message, sender);
      if (result && result::objectToString() === '[object Promise]') {
        sendResponseAsync(result, sendResponse);
        return true;
      }
      // In some browsers (e.g Chrome 56, Vivaldi), the listener in
      // popup pages are not properly cleared after closed.
      // They may send `undefined` before the real response is sent.
      if (result !== undefined) {
        sendResponse(wrapSuccess(result));
      }
    } catch (err) {
      sendResponse(wrapError(err));
    }
  };
  /** @type {WrapAsyncPreprocessorFunc} */
  const unwrapResponse = (resolve, response) => (
    !response && 'null response'
    || response[1] // error created in wrapError
    || resolve(response[0]) // result created in wrapSuccess
  );
  const wrapSendMessage = (runtime, sendMessage) => (
    wrapAsync(runtime, sendMessage, unwrapResponse)
  );
  /**
   * 0 = non-async method or the entire group
   * function = transformer like (originalObj, originalFunc): function
   */
  global.browser = proxifyGroup(chrome, {
    extension: 0, // we don't use its async methods
    i18n: 0, // we don't use its async methods
    runtime: {
      connect: 0,
      getManifest: 0,
      getURL: 0,
      onMessage: {
        addListener: (onMessage, addListener) => (
          listener => onMessage::addListener(onMessageListener::bind(null, listener))
        ),
      },
      sendMessage: wrapSendMessage,
    },
    tabs: {
      connect: 0,
      sendMessage: wrapSendMessage,
    },
  });
  // endregion
} else if (process.env.DEBUG && IS_FIREFOX) {
  // region Firefox
  /* eslint-disable no-restricted-syntax */// this is a debug-only section
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
    (typeof result?.then === 'function' ? result : PromiseSafe.resolve(result))
    .then(data => log('on', [data], id, true), console.warn);
    return result;
  });
  /* eslint-enable no-restricted-syntax */
  // endregion
}

/**
 * @callback WrapAsyncPreprocessorFunc
 * @param {function(any)} resolve - called on success
 * @param {any} response - API callback's response
 * @returns {?string[]} - [errorMessage, errorStack] array on error
 */
