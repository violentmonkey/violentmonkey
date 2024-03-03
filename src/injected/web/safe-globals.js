/* eslint-disable one-var, one-var-declaration-per-line, no-unused-vars,
   prefer-const */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * To ensure the minified name is 1 char we declare the super frequently used names first.
 */

export let
  safeCall, // ~50 "::" calls
  createNullObj, // ~25 calls
  forEach, // ~15 calls
  safeApply,
  safeBind,
  // window
  SafeCustomEvent,
  SafeDOMParser,
  SafeError,
  SafeEventTarget,
  SafeKeyboardEvent,
  SafeMouseEvent,
  Object,
  SafeProxy,
  SafeSymbol,
  UnsafePromise,
  fire,
  getWindowLength,
  getWindowParent,
  off,
  on,
  // Symbol
  toStringTagSym,
  // Object
  assign,
  defineProperty,
  describeProperty,
  getPrototypeOf,
  setPrototypeOf,
  objectKeys,
  objectValues,
  /** Array.prototype can be eavesdropped via setters like '0','1',...
   * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
   * its length or from an unassigned `hole`. */
  concat,
  filter,
  indexOf,
  // Element.prototype
  remove,
  // String.prototype
  slice,
  // various values
  builtinGlobals,
  // various methods
  URLToString,
  arrayIsArray,
  formDataEntries,
  hasOwnProperty,
  jsonParse,
  jsonStringify,
  logging,
  mathRandom,
  parseFromString, // DOMParser
  reflectOwnKeys,
  stopImmediatePropagation,
  then,
  urlSearchParamsToString,
  // various getters
  getCurrentScript, // Document
  getDetail, // CustomEvent
  getRelatedTarget; // MouseEvent

export const cloneInto = PAGE_MODE_HANDSHAKE ? null : global.cloneInto;
/**
 * VAULT consists of the parent's safe globals to protect our communications/globals
 * from a page that creates an iframe with src = location and modifies its contents
 * immediately after adding it to DOM via direct manipulation in frame.contentWindow
 * or window[0] before our content script runs at document_start, https://crbug.com/1261964 */
export const VAULT = (() => {
  let ArrayP;
  let Reflect;
  let SafeObject;
  let i = -1;
  let call;
  /** Precaution against browser bugs: Symbol.toStringTag was exposed on `window` in FF88 */
  let getOwnPropertyNames;
  let res;
  let srcFF;
  let src = global; // FF defines some stuff only on `global` in content mode
  let srcWindow = window;
  if (VAULT_ID) {
    res = window[VAULT_ID];
    delete window[VAULT_ID];
  }
  if (res && !isFunction(res[0])) {
    // res is [this, addVaultExports object]
    // injectPageSandbox iframe's `global` is `window` because it's in page mode
    src = res[0];
    srcWindow = src;
    // In FF some stuff from a detached iframe doesn't work, so we export it from content
    srcFF = IS_FIREFOX && res[1];
    res = false;
  }
  if (!res) {
    res = { __proto__: null };
  }
  res = [
    // window
    SafeCustomEvent = res[i += 1] || src.CustomEvent,
    SafeDOMParser = res[i += 1] || src.DOMParser,
    SafeError = res[i += 1] || src.Error,
    SafeEventTarget = res[i += 1] || src.EventTarget,
    SafeKeyboardEvent = res[i += 1] || src.KeyboardEvent,
    SafeMouseEvent = res[i += 1] || src.MouseEvent,
    Object = res[i += 1] || src.Object,
    SafeSymbol = res[i += 1] || src.Symbol,
    // In FF content mode global.Proxy !== window.Proxy
    SafeProxy = res[i += 1] || src.Proxy,
    fire = res[i += 1] || src.dispatchEvent,
    off = res[i += 1] || src.removeEventListener,
    on = res[i += 1] || src.addEventListener,
    // Object - using SafeObject to pacify eslint without disabling the rule
    defineProperty = (SafeObject = Object) && res[i += 1] || SafeObject.defineProperty,
    describeProperty = res[i += 1] || SafeObject.getOwnPropertyDescriptor,
    getOwnPropertyNames = res[i += 1] || SafeObject.getOwnPropertyNames,
    getPrototypeOf = res[i += 1] || SafeObject.getPrototypeOf,
    setPrototypeOf = res[i += 1] || SafeObject.setPrototypeOf,
    assign = res[i += 1] || SafeObject.assign,
    objectKeys = res[i += 1] || SafeObject.keys,
    objectValues = res[i += 1] || SafeObject.values,
    // Array.prototype
    concat = res[i += 1] || (ArrayP = src.Array[PROTO]).concat,
    filter = res[i += 1] || ArrayP.filter,
    forEach = res[i += 1] || ArrayP.forEach,
    indexOf = res[i += 1] || ArrayP.indexOf,
    // Element.prototype
    remove = res[i += 1] || src.Element[PROTO].remove,
    // String.prototype
    slice = res[i += 1] || src.String[PROTO].slice,
    // safeCall
    safeApply = res[i += 1] || (Reflect = src.Reflect).apply,
    safeCall = res[i += 1] || (call = SafeObject.call).bind(call),
    // WARNING! In FF bind fails when used with `window` events, see proxyDescribe
    safeBind = res[i += 1] || call.bind(SafeObject.bind),
    // various methods
    URLToString = res[i += 1] || src.URL[PROTO].toString,
    createNullObj = res[i += 1] || safeBind(SafeObject.create, SafeObject, null),
    formDataEntries = res[i += 1] || src.FormData[PROTO].entries,
    hasOwnProperty = res[i += 1] || safeBind(call, SafeObject[PROTO].hasOwnProperty),
    arrayIsArray = res[i += 1] || src.Array.isArray,
    /* Exporting JSON methods separately instead of exporting SafeJSON as its props may be broken
     * by the page if it gains access to any Object from the vault e.g. a thrown SafeError. */
    jsonParse = res[i += 1] || src.JSON.parse,
    jsonStringify = res[i += 1] || src.JSON.stringify,
    logging = res[i += 1] || nullObjFrom((srcFF || src).console),
    mathRandom = res[i += 1] || src.Math.random,
    parseFromString = res[i += 1] || SafeDOMParser[PROTO].parseFromString,
    reflectOwnKeys = res[i += 1] || Reflect.ownKeys,
    stopImmediatePropagation = res[i += 1] || src.Event[PROTO].stopImmediatePropagation,
    then = res[i += 1] || src.Promise[PROTO].then,
    urlSearchParamsToString = res[i += 1] || src.URLSearchParams[PROTO].toString,
    // various getters
    getCurrentScript = res[i += 1] || describeProperty(src.Document[PROTO], 'currentScript').get,
    getDetail = res[i += 1] || describeProperty(SafeCustomEvent[PROTO], 'detail').get,
    getRelatedTarget = res[i += 1] || describeProperty(SafeMouseEvent[PROTO], 'relatedTarget').get,
    getWindowLength = res[i += 1] || describeProperty(srcWindow, 'length').get
      || (() => getOwnProp(window, 'length', 1e9)), // Chrome<=85 https://crrev.com/793165
    getWindowParent = res[i += 1] || describeProperty(srcWindow, 'parent').get
      || (() => getOwnProp(window, 'parent')), // Chrome<=85 https://crrev.com/793165
    // various values
    builtinGlobals = res[i += 1] || [
      getOwnPropertyNames(srcWindow),
      src !== srcWindow && getOwnPropertyNames(src),
    ],
  ];
  // Well-known Symbols are unforgeable
  toStringTagSym = SafeSymbol.toStringTag;
  return res;
})();

try {
  /* We can't use safe Promise from vault because it stops working when iframe is removed,
   * so we use the unsafe current global - only for userscript API stuff, not internally.
   * Using `try` because the `Promise` global may be an already spoofed getter.
   * TODO: try reimplementing Promise in our sandbox wrapper if it can work with user code */
  UnsafePromise = Promise;
} catch (e) { /**/ }
