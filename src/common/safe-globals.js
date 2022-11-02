/* eslint-disable no-unused-vars */

/**
 * This file is used by entire `src` except `injected`.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * Standard globals are extracted for better minification and marginally improved lookup speed.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 */

const global = (function _() {
  return this || globalThis; // eslint-disable-line no-undef
}());
const {
  Boolean,
  Error,
  Object,
  Promise,
  document,
  window,
  performance,
} = global;
export const SafePromise = Promise; // alias used by browser.js
export const SafeError = Error; // alias used by browser.js
export const { apply: safeApply, has: hasOwnProperty } = Reflect;
export const safeCall = Object.call.bind(Object.call);
export const IS_FIREFOX = !global.chrome.app;
export const isFunction = val => typeof val === 'function';
export const isObject = val => val != null && typeof val === 'object';
export const VIOLENTMONKEY = 'Violentmonkey';
export const kResponseHeaders = 'responseHeaders';
export const kResponseText = 'responseText';
export const kResponseType = 'responseType';
