/* eslint-disable no-unused-vars */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 */

export const {
  Blob: BlobSafe,
  CustomEvent: CustomEventSafe,
  Error, // for #/common e.g. in sendMessage
  MouseEvent: MouseEventSafe,
  Object, // for minification and guarding webpack Object(import) calls
  Promise: PromiseSafe,
  TextDecoder: TextDecoderSafe,
  Uint8Array: Uint8ArraySafe,
  atob: atobSafe,
  addEventListener: on,
  dispatchEvent: fire,
  removeEventListener: off,
} = global;
export const ErrorSafe = Error;
export const ResponseProto = Response[PROTO];
export const { hasOwnProperty, toString: objectToString } = {};
export const { apply, call } = hasOwnProperty;
export const safeCall = call.bind(call);
export const { forEach, includes, push } = [];
export const { createElementNS, getElementsByTagName } = document;
export const { then } = PromiseSafe[PROTO];
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
export const { decode: tdDecode } = TextDecoderSafe[PROTO];
export const { stopImmediatePropagation } = Event[PROTO];
export const { get: getHref } = describeProperty(HTMLAnchorElement[PROTO], 'href');
export const getDetail = describeProperty(CustomEventSafe[PROTO], 'detail').get;
export const getRelatedTarget = describeProperty(MouseEventSafe[PROTO], 'relatedTarget').get;
export const getReadyState = describeProperty(Document[PROTO], 'readyState').get;
export const isDocumentLoading = () => !/^(inter|compl)/::regexpTest(document::getReadyState());
export const logging = assign(createNullObj(), console);
export const { chrome } = global;
export const IS_FIREFOX = !chrome.app;
export const VM_UUID = chrome.runtime.getURL('');
