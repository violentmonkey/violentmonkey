/* eslint-disable camelcase, one-var, one-var-declaration-per-line, no-unused-vars,
   prefer-const, import/no-mutable-exports */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * WARNING! Don't use modern JS syntax like ?. or ?? as this file isn't preprocessed by Babel.
 */

export let
  // window
  BlobSafe,
  CustomEventSafe,
  ErrorSafe,
  KeyboardEventSafe,
  MouseEventSafe,
  Object,
  PromiseSafe,
  ProxySafe,
  Uint8ArraySafe,
  atobSafe,
  fire,
  off,
  on,
  openWindow,
  // Symbol
  scopeSym,
  toStringTag,
  // Object
  apply,
  assign,
  bind,
  defineProperty,
  describeProperty,
  getOwnPropertyNames,
  getOwnPropertySymbols,
  objectKeys,
  objectValues,
  // Object.prototype
  hasOwnProperty,
  objectToString,
  /** Array.prototype can be eavesdropped via setters like '0','1',...
   * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
   * its length or from an unassigned `hole`. */
  concat,
  filter,
  forEach,
  indexOf,
  map,
  // Element.prototype
  remove,
  setAttribute,
  // String.prototype
  charCodeAt,
  slice,
  replace,
  // document
  createElementNS,
  // various methods
  safeCall,
  funcToString,
  jsonParse,
  mathRandom,
  regexpTest,
  then,
  logging,
  // various getters
  getDetail,
  getRelatedTarget,
  getCurrentScript;

/**
 * VAULT consists of the parent's safe globals to protect our communications/globals
 * from a page that creates an iframe with src = location and modifies its contents
 * immediately after adding it to DOM via direct manipulation in frame.contentWindow
 * or window[0] before our content script runs at document_start, https://crbug.com/1261964 */
export const VAULT = (() => {
  let ArrayP;
  let ElementP;
  let StringP;
  let i = -1;
  let res;
  if (process.env.VAULT_ID) {
    res = window[process.env.VAULT_ID];
    delete window[process.env.VAULT_ID];
  }
  if (!res) {
    res = { __proto__: null };
  }
  res = [
    // window
    BlobSafe = res[i += 1] || window.Blob,
    CustomEventSafe = res[i += 1] || window.CustomEvent,
    ErrorSafe = res[i += 1] || window.Error,
    KeyboardEventSafe = res[i += 1] || window.KeyboardEvent,
    MouseEventSafe = res[i += 1] || window.MouseEvent,
    Object = res[i += 1] || window.Object,
    PromiseSafe = res[i += 1] || window.Promise,
    ProxySafe = res[i += 1] || global.Proxy, // In FF content mode it's not equal to window.Proxy
    Uint8ArraySafe = res[i += 1] || window.Uint8Array,
    atobSafe = res[i += 1] || window.atob,
    fire = res[i += 1] || window.dispatchEvent,
    off = res[i += 1] || window.removeEventListener,
    on = res[i += 1] || window.addEventListener,
    openWindow = res[i += 1] || window.open,
    // Symbol
    scopeSym = res[i += 1] || Symbol.unscopables,
    toStringTag = res[i += 1] || Symbol.toStringTag,
    // Object
    describeProperty = res[i += 1] || Object.getOwnPropertyDescriptor,
    defineProperty = res[i += 1] || Object.defineProperty,
    getOwnPropertyNames = res[i += 1] || Object.getOwnPropertyNames,
    getOwnPropertySymbols = res[i += 1] || Object.getOwnPropertySymbols,
    assign = res[i += 1] || Object.assign,
    objectKeys = res[i += 1] || Object.keys,
    objectValues = res[i += 1] || Object.values,
    apply = res[i += 1] || Object.apply,
    bind = res[i += 1] || Object.bind,
    // Object.prototype
    hasOwnProperty = res[i += 1] || Object[PROTO].hasOwnProperty,
    objectToString = res[i += 1] || Object[PROTO].toString,
    // Array.prototype
    concat = res[i += 1] || (ArrayP = Array[PROTO]).concat,
    filter = res[i += 1] || ArrayP.filter,
    forEach = res[i += 1] || ArrayP.forEach,
    indexOf = res[i += 1] || ArrayP.indexOf,
    map = res[i += 1] || ArrayP.map,
    // Element.prototype
    remove = res[i += 1] || (ElementP = Element[PROTO]).remove,
    setAttribute = res[i += 1] || ElementP.setAttribute,
    // String.prototype
    charCodeAt = res[i += 1] || (StringP = String[PROTO]).charCodeAt,
    slice = res[i += 1] || StringP.slice,
    replace = res[i += 1] || StringP.replace,
    // document
    createElementNS = res[i += 1] || document.createElementNS,
    // various methods
    safeCall = res[i += 1] || Object.call.bind(Object.call),
    funcToString = res[i += 1] || safeCall.toString,
    jsonParse = res[i += 1] || JSON.parse,
    mathRandom = res[i += 1] || Math.random,
    regexpTest = res[i += 1] || RegExp[PROTO].test,
    then = res[i += 1] || PromiseSafe[PROTO].then,
    logging = res[i += 1] || assign({ __proto__: null }, console),
    // various getters
    getDetail = res[i += 1] || describeProperty(CustomEventSafe[PROTO], 'detail').get,
    getRelatedTarget = res[i += 1] || describeProperty(MouseEventSafe[PROTO], 'relatedTarget').get,
    getCurrentScript = res[i += 1] || describeProperty(Document[PROTO], 'currentScript').get,
  ];
  return res;
})();
