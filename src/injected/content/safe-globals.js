/* eslint-disable no-unused-vars, prefer-const */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 */

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
  dispatchEvent: fire,
  removeEventListener: off,
} = global;
export const SafeError = Error;
export const ResponseProto = SafeResponse[PROTO];
export const { apply: safeApply } = Reflect;
export const hasOwnProperty = safeApply.call.bind(({}).hasOwnProperty);
export const safeCall = safeApply.call.bind(safeApply.call);
export const { forEach, includes } = []; // `push` is unsafe as it may call a setter; use safePush()
export const { getElementsByTagName } = document;
export const { then } = SafePromise[PROTO];
export const { indexOf: stringIndexOf, slice } = '';
export const safeCharCodeAt = safeApply.call.bind(''.charCodeAt); // faster than str::charCodeAt
export const { append, appendChild, attachShadow, remove, setAttribute } = Element[PROTO];
export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  getPrototypeOf,
  keys: objectKeys,
} = Object;
// eslint-disable-next-line no-restricted-syntax
export const createNullObj = Object.create.bind(Object, null);
export const { random: mathRandom } = Math;
export const { toStringTag: toStringTagSym } = Symbol; // used by ProtectWebpackBootstrapPlugin
export const { stopImmediatePropagation } = Event[PROTO];
export const getDetail = describeProperty(SafeCustomEvent[PROTO], 'detail').get;
export const getRelatedTarget = describeProperty(SafeMouseEvent[PROTO], 'relatedTarget').get;
export const logging = nullObjFrom(console);
export const VM_UUID = global.chrome.runtime.getURL('');
/** Unlike the built-in `instanceof` operator this doesn't call @@hasInstance which may be spoofed */
export const isInstance = (instance, safeOriginalProto) => {
  for (let obj = instance; isObject(obj) && (obj = getPrototypeOf(obj));) {
    if (obj === safeOriginalProto) {
      return true;
    }
  }
};
export const isPromise = (proto => val => isInstance(val, proto))(SafePromise[PROTO]);
export let IS_FIREFOX = !global.chrome.app;
