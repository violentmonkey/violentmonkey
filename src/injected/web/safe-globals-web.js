/* eslint-disable one-var, one-var-declaration-per-line, no-unused-vars,
   prefer-const, import/no-mutable-exports */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 */

export let
  // window
  BlobSafe,
  CustomEventSafe,
  DOMParserSafe,
  ErrorSafe,
  FileReaderSafe,
  KeyboardEventSafe,
  MouseEventSafe,
  Object,
  PromiseSafe,
  ProxySafe,
  ResponseSafe,
  SymbolSafe,
  fire,
  off,
  on,
  openWindow,
  safeIsFinite,
  // Symbol
  toStringTagSym,
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
  // Element.prototype
  remove,
  // String.prototype
  charCodeAt,
  slice,
  // safeCall
  safeCall,
  // various methods
  createObjectURL,
  funcToString,
  ArrayIsArray,
  jsonParse,
  logging,
  mathRandom,
  parseFromString, // DOMParser
  readAsDataURL, // FileReader
  safeResponseBlob, // Response - safe = "safe global" to disambiguate the name
  stopImmediatePropagation,
  regexpReplace,
  then,
  // various getters
  getBlobType, // Blob
  getCurrentScript, // Document
  getDetail, // CustomEvent
  getReaderResult, // FileReader
  getRelatedTarget; // MouseEvent

/**
 * VAULT consists of the parent's safe globals to protect our communications/globals
 * from a page that creates an iframe with src = location and modifies its contents
 * immediately after adding it to DOM via direct manipulation in frame.contentWindow
 * or window[0] before our content script runs at document_start, https://crbug.com/1261964 */
export const VAULT = (() => {
  let ArrayP;
  let ElementP;
  let ObjectSafe;
  let StringP;
  let i = -1;
  let call;
  let res;
  let src = global; // FF defines some stuff only on `global` in content mode
  if (process.env.VAULT_ID) {
    res = window[process.env.VAULT_ID];
    delete window[process.env.VAULT_ID];
  }
  if (!res) {
    res = createNullObj();
  } else if (!isFunction(res[0])) {
    src = res[0];
    res = createNullObj();
  }
  res = [
    // window
    BlobSafe = res[i += 1] || src.Blob,
    CustomEventSafe = res[i += 1] || src.CustomEvent,
    DOMParserSafe = res[i += 1] || src.DOMParser,
    ErrorSafe = res[i += 1] || src.Error,
    FileReaderSafe = res[i += 1] || src.FileReader,
    KeyboardEventSafe = res[i += 1] || src.KeyboardEvent,
    MouseEventSafe = res[i += 1] || src.MouseEvent,
    Object = res[i += 1] || src.Object,
    PromiseSafe = res[i += 1] || src.Promise,
    SymbolSafe = res[i += 1] || src.Symbol,
    // In FF content mode global.Proxy !== window.Proxy
    ProxySafe = res[i += 1] || src.Proxy,
    ResponseSafe = res[i += 1] || src.Response,
    fire = res[i += 1] || src.dispatchEvent,
    safeIsFinite = res[i += 1] || src.isFinite, // Firefox defines `isFinite` on `global`
    off = res[i += 1] || src.removeEventListener,
    on = res[i += 1] || src.addEventListener,
    openWindow = res[i += 1] || src.open,
    // Object - using ObjectSafe to pacify eslint without disabling the rule
    defineProperty = (ObjectSafe = Object) && res[i += 1] || ObjectSafe.defineProperty,
    describeProperty = res[i += 1] || ObjectSafe.getOwnPropertyDescriptor,
    getOwnPropertyNames = res[i += 1] || ObjectSafe.getOwnPropertyNames,
    getOwnPropertySymbols = res[i += 1] || ObjectSafe.getOwnPropertySymbols,
    assign = res[i += 1] || ObjectSafe.assign,
    objectKeys = res[i += 1] || ObjectSafe.keys,
    objectValues = res[i += 1] || ObjectSafe.values,
    apply = res[i += 1] || ObjectSafe.apply,
    bind = res[i += 1] || ObjectSafe.bind,
    // Object.prototype
    hasOwnProperty = res[i += 1] || ObjectSafe[PROTO].hasOwnProperty,
    objectToString = res[i += 1] || ObjectSafe[PROTO].toString,
    // Array.prototype
    concat = res[i += 1] || (ArrayP = src.Array[PROTO]).concat,
    filter = res[i += 1] || ArrayP.filter,
    forEach = res[i += 1] || ArrayP.forEach,
    indexOf = res[i += 1] || ArrayP.indexOf,
    // Element.prototype
    remove = res[i += 1] || (ElementP = src.Element[PROTO]).remove,
    // String.prototype
    charCodeAt = res[i += 1] || (StringP = src.String[PROTO]).charCodeAt,
    slice = res[i += 1] || StringP.slice,
    // safeCall
    safeCall = res[i += 1] || (call = ObjectSafe.call).bind(call),
    // various methods
    createObjectURL = res[i += 1] || src.URL.createObjectURL,
    funcToString = res[i += 1] || safeCall.toString,
    ArrayIsArray = res[i += 1] || src.Array.isArray,
    jsonParse = res[i += 1] || src.JSON.parse,
    logging = res[i += 1] || assign({ __proto__: null }, src.console),
    mathRandom = res[i += 1] || src.Math.random,
    parseFromString = res[i += 1] || DOMParserSafe[PROTO].parseFromString,
    readAsDataURL = res[i += 1] || FileReaderSafe[PROTO].readAsDataURL,
    safeResponseBlob = res[i += 1] || ResponseSafe[PROTO].blob,
    stopImmediatePropagation = res[i += 1] || src.Event[PROTO].stopImmediatePropagation,
    regexpReplace = res[i += 1] || src.RegExp[PROTO][SymbolSafe.replace],
    then = res[i += 1] || PromiseSafe[PROTO].then,
    // various getters
    getBlobType = res[i += 1] || describeProperty(BlobSafe[PROTO], 'type').get,
    getCurrentScript = res[i += 1] || describeProperty(src.Document[PROTO], 'currentScript').get,
    getDetail = res[i += 1] || describeProperty(CustomEventSafe[PROTO], 'detail').get,
    getReaderResult = res[i += 1] || describeProperty(FileReaderSafe[PROTO], 'result').get,
    getRelatedTarget = res[i += 1] || describeProperty(MouseEventSafe[PROTO], 'relatedTarget').get,
  ];
  // Well-known Symbols are unforgeable
  toStringTagSym = SymbolSafe.toStringTag;
  return res;
})();
