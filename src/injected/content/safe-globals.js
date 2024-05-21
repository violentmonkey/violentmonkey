/* eslint-disable no-unused-vars, prefer-const */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * To ensure the minified name is 1 char we declare the super frequently used names first.
 */

export const { apply: safeApply } = Reflect;
export const safeCall = safeApply.call.bind(safeApply.call); // ~75 "::" calls
export const {
  Blob: SafeBlob,
  CustomEvent: SafeCustomEvent,
  Error, // for @/common e.g. in sendMessage
  MouseEvent: SafeMouseEvent,
  Object, // for minification and guarding webpack Object(import) calls
  Promise: SafePromise,
  Response: SafeResponse,
  Uint8Array: SafeUint8Array,
  atob: safeAtob,
  addEventListener: on,
  cloneInto,
  chrome,
  dispatchEvent: fire,
  removeEventListener: off,
} = global;
// eslint-disable-next-line no-restricted-syntax
export const createNullObj = Object.create.bind(Object, null); // 25 calls
export const SafeError = Error;
export const ResponseProto = SafeResponse[PROTO];
export const hasOwnProperty = safeApply.call.bind(({}).hasOwnProperty);
export const { forEach, includes, map } = []; // `push` is unsafe as it may call a setter; use safePush()
export const { then } = SafePromise[PROTO];
export const { indexOf: stringIndexOf, slice } = '';
export const safeCharCodeAt = safeApply.call.bind(''.charCodeAt); // faster than str::charCodeAt
export const { append, appendChild, attachShadow, remove, setAttribute } = Element[PROTO];
export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  getPrototypeOf,
  setPrototypeOf,
  keys: objectKeys,
} = Object;
export const { random: mathRandom } = Math;
export const { toStringTag: toStringTagSym } = Symbol; // used by ProtectWebpackBootstrapPlugin
export const { stopImmediatePropagation } = Event[PROTO];
export const getDetail = describeProperty(SafeCustomEvent[PROTO], 'detail').get;
export const getRelatedTarget = describeProperty(SafeMouseEvent[PROTO], 'relatedTarget').get;
export const logging = nullObjFrom(console);
export const VM_UUID = chrome.runtime.getURL('');
/** Unlike the built-in `instanceof` operator this doesn't call @@hasInstance which may be spoofed */
export const isInstance = (instance, safeOriginalProto) => {
  for (let obj = instance; isObject(obj) && (obj = getPrototypeOf(obj));) {
    if (obj === safeOriginalProto) {
      return true;
    }
  }
};
export const isPromise = (proto => val => isInstance(val, proto))(SafePromise[PROTO]);
/** It's unforgeable so we extract it primarily to improve minification.
 * The document's value can change only in about:blank but we don't inject there. */
const { document } = global;
export const { getElementsByTagName } = document;
export const REIFY = 'reify';
export let IS_FIREFOX = global !== window; // true in Firefox content script context
/** @type {VMTopRenderMode} */
export let topRenderMode = window !== top ? 0
  // TODO: revisit when link-preview is shipped in Chrome
  : document.prerendering && document.visibilityState === 'hidden' ? 2
    : 1;

