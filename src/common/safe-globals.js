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
  addEventListener, removeEventListener,
  chrome,
  performance,
} = global;
export const SafePromise = Promise; // alias used by browser.js
export const SafeError = Error; // alias used by browser.js
export const { apply: safeApply } = Reflect;
export const hasOwnProperty = safeApply.call.bind(({}).hasOwnProperty);
export const safeCall = Object.call.bind(Object.call);
export const IS_APPLIED = 'isApplied';
export const IS_FIREFOX = 'contextualIdentities' in chrome;
export const ROUTE_SCRIPTS = '#' + SCRIPTS;
export const extensionRoot = chrome.runtime.getURL('/');
export const extensionOrigin = extensionRoot.slice(0, -1);
export const extensionManifest = chrome.runtime.getManifest();
// Using getURL because in Firefox manifest contains resolved (full) URLs
export const extensionOptionsPage = process.env.TEST ? ''
  : chrome.runtime.getURL(extensionManifest.options_ui.page).split('#', 1)[0];
export const ICON_PREFIX = chrome.runtime.getURL(extensionManifest.icons[16].replace("16.png", ""));
export const TAB_SETTINGS = 'settings';
export const TAB_ABOUT = 'about';
export const TAB_RECYCLE = 'recycleBin';
export const BROWSER_ACTION = 'browser_action';
export const kDocumentId = 'documentId';
export const kFrameId = 'frameId';
export const INJECT = 'inject';
export const MULTI = 'multi';
export const kWindowId = 'windowId';
