/* eslint-disable no-unused-vars */

/**
 * This file is used first by the entire `src` including `injected`.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 */

const global = process.env.TEST ? globalThis : this; // eslint-disable-line no-undef
const { window } = global; // it's unforgeable so we extract it primarily to improve minification
export const VIOLENTMONKEY = 'Violentmonkey';
export const AUTO = 'auto';
export const CONTENT = 'content';
export const EXPOSE = 'expose';
export const FORCE_CONTENT = 'forceContent';
export const IDS = 'ids';
export const ID_BAD_REALM = -1;
export const ID_INJECTING = 2;
export const INJECT_INTO = 'injectInto';
export const MORE = 'more';
export const PAGE = 'page';
export const RUN_AT = 'runAt';
export const SCRIPTS = 'scripts';
export const VALUES = 'values';
export const kResponse = 'response';
export const kResponseHeaders = 'responseHeaders';
export const kResponseText = 'responseText';
export const kResponseType = 'responseType';
export const kSessionId = 'sessionId';
export const kTop = 'top';
export const kXhrType = 'xhrType';
export const SKIP_SCRIPTS = 'SkipScripts';
export const isFunction = val => typeof val === 'function';
export const isObject = val => val != null && typeof val === 'object';
export const kFileName = 'fileName';
