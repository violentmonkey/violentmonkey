/* eslint-disable no-unused-vars */

/**
 * This file is used by entire `src` except `injected`.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * Standard globals are extracted for better minification and marginally improved lookup speed.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 * WARNING! Don't use modern JS syntax like ?. or ?? as this file isn't preprocessed by Babel.
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
} = global;
export const PromiseSafe = Promise; // alias used by browser.js
export const ErrorSafe = Error; // alias used by browser.js
export const { hasOwnProperty, toString: objectToString } = {};
export const safeCall = Object.call.bind(Object.call);
export const IS_FIREFOX = !global.chrome.app;
