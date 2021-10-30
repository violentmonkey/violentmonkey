/* eslint-disable no-unused-vars */

/**
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * WARNING! Don't use modern JS syntax like ?. or ?? as this file isn't preprocessed by Babel.
 */

export const {
  CustomEvent: CustomEventSafe,
  Error: ErrorSafe,
  MouseEvent: MouseEventSafe,
  Object, // for minification and guarding webpack Object(import) calls
  Promise: PromiseSafe,
  addEventListener: on,
  dispatchEvent: fire,
  removeEventListener: off,
} = global;
export const { hasOwnProperty, toString: objectToString } = {};
export const { apply, call } = hasOwnProperty;
export const safeCall = call.bind(call);
export const { forEach, includes, push } = [];
export const { createElementNS, getElementsByTagName } = document;
export const { then } = Promise[PROTO];
export const { slice } = '';
export const { append, appendChild, remove, setAttribute } = Element[PROTO];
export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  keys: objectKeys,
} = Object;
export const { random: mathRandom } = Math;
export const regexpTest = RegExp[PROTO].test;
export const { toStringTag } = Symbol; // used by ProtectWebpackBootstrapPlugin
export const getDetail = describeProperty(CustomEventSafe[PROTO], 'detail').get;
export const getRelatedTarget = describeProperty(MouseEventSafe[PROTO], 'relatedTarget').get;
export const logging = assign({ __proto__: null }, console);
export const IS_FIREFOX = !global.chrome.app;
