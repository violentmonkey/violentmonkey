/* eslint-disable no-unused-vars */

/**
 * This file is used by entire `src` except `injected`.
 * `safeCall` is used by our modified babel-plugin-safe-bind.js.
 * Standard globals are extracted for better minification and marginally improved lookup speed.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 */

const {
  Boolean,
  Error,
  Object,
  Promise,
  performance,
} = global;
export const SafePromise = Promise; // alias used by browser.js
export const SafeError = Error; // alias used by browser.js
export const { apply: safeApply } = Reflect;
export const hasOwnProperty = safeApply.call.bind(({}).hasOwnProperty);
export const safeCall = Object.call.bind(Object.call);
export const IS_FIREFOX = !global.chrome.app;
