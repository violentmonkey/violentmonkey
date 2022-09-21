/* eslint-disable no-unused-vars */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 */

export const {
  Blob: SafeBlob,
  CustomEvent: SafeCustomEvent,
  Error, // for #/common e.g. in sendMessage
  MouseEvent: SafeMouseEvent,
  Object, // for minification and guarding webpack Object(import) calls
  Promise: SafePromise,
  Response: SafeResponse,
  TextDecoder: SafeTextDecoder,
  Uint8Array: SafeUint8Array,
  atob: safeAtob,
  addEventListener: on,
  dispatchEvent: fire,
  removeEventListener: off,
} = global;
export const SafeError = Error;
export const ResponseProto = SafeResponse[PROTO];
export const { hasOwnProperty, toString: objectToString } = {};
export const { apply, call } = hasOwnProperty;
export const safeCall = call.bind(call);
export const { forEach, includes, push } = [];
export const { createElementNS, getElementsByTagName } = document;
export const { then } = SafePromise[PROTO];
export const { charCodeAt, indexOf: stringIndexOf, slice } = '';
export const { append, appendChild, attachShadow, remove, setAttribute } = Element[PROTO];
export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  keys: objectKeys,
} = Object;
export const { random: mathRandom } = Math;
export const regexpTest = RegExp[PROTO].test;
export const { toStringTag: toStringTagSym } = Symbol; // used by ProtectWebpackBootstrapPlugin
export const { decode: tdDecode } = SafeTextDecoder[PROTO];
export const { stopImmediatePropagation } = Event[PROTO];
export const { get: getHref } = describeProperty(HTMLAnchorElement[PROTO], 'href');
export const getDetail = describeProperty(SafeCustomEvent[PROTO], 'detail').get;
export const getRelatedTarget = describeProperty(SafeMouseEvent[PROTO], 'relatedTarget').get;
export const getReadyState = describeProperty(Document[PROTO], 'readyState').get;
export const isDocumentLoading = () => !/^(inter|compl)/::regexpTest(document::getReadyState());
export const logging = assign(createNullObj(), console);
export const { chrome } = global;
export const IS_FIREFOX = !chrome.app;
export const VM_UUID = chrome.runtime.getURL('');
