/* eslint-disable no-unused-vars */

/**
 * This file is used first by the entire `src` including `injected`.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 */

const global = (function _() {
  return this || globalThis; // eslint-disable-line no-undef
}());
/** These two are unforgeable so we extract them primarily to improve minification.
 * The document's value can change only in about:blank but we don't inject there. */
const { document, window } = global;
export const VIOLENTMONKEY = 'Violentmonkey';
export const INJECT_AUTO = 'auto';
export const INJECT_PAGE = 'page';
export const INJECT_CONTENT = 'content';
export const INJECT_CONTENT_FORCE = 'forceContent';
export const INJECT_INTO = 'injectInto';
export const INJECT_MORE = 'more';
export const ID_BAD_REALM = -1;
export const ID_INJECTING = 2;
export const kResponseHeaders = 'responseHeaders';
export const kResponseText = 'responseText';
export const kResponseType = 'responseType';
export const isFunction = val => typeof val === 'function';
export const isObject = val => val != null && typeof val === 'object';
