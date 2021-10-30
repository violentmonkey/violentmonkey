/* eslint-disable no-unused-vars */

/**
 * This file is used by both `injected` and `injected-web` entries.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * WARNING! Don't use modern JS syntax like ?. or ?? as this file isn't preprocessed by Babel.
 */

const global = (function _() {
  return this || globalThis; // eslint-disable-line no-undef
}());
/** These two are unforgeable so we extract them primarily to improve minification.
 * The document's value can change only in about:blank but we don't inject there. */
const { document, window } = global;
export const PROTO = 'prototype';
export const IS_TOP = window.top === window;
