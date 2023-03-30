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
  chrome,
  performance,
} = global;
export const SafePromise = Promise; // alias used by browser.js
export const SafeError = Error; // alias used by browser.js
export const { apply: safeApply } = Reflect;
export const hasOwnProperty = safeApply.call.bind(({}).hasOwnProperty);
export const safeCall = Object.call.bind(Object.call);
export const IS_FIREFOX = !chrome.app;
export const ROUTE_SCRIPTS = '#' + SCRIPTS;
export const extensionRoot = chrome.runtime.getURL('/');
export const extensionOrigin = extensionRoot.slice(0, -1);
export const extensionManifest = chrome.runtime.getManifest();
// Using getURL because in Firefox manifest contains resolved (full) URLs
export const extensionOptionsPage = chrome.runtime.getURL(extensionManifest.options_ui.page);
export const ICON_PREFIX = chrome.runtime.getURL(extensionManifest.icons[16].replace("16.png", ""));
