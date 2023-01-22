import { i18n, makeDataUri, noop } from '@/common';
import { BLACKLIST, INJECTABLE_TAB_URL_RE } from '@/common/consts';
import { objectPick } from '@/common/object';
import { postInitialize } from './init';
import { addOwnCommands, addPublicCommands, forEachTab } from './message';
import { getOption, hookOptions } from './options';
import { getTabUrl } from './tabs';
import { testBlacklist } from './tester';
import storage from './storage';

addOwnCommands({
  GetImageData: async url => (
    url.startsWith(ICON_PREFIX)
      ? (await getOwnIcon(new URL(url).pathname)).uri
      : (await storage.cache.fetch(url), makeDataUri(await storage.cache.getOne(url)))
  ),
});

addPublicCommands({
  SetBadge: setBadge,
});

/** We don't set 19px because FF and Vivaldi scale it down to 16px instead of our own crisp 16px */
const SIZES = [16, 32];
/** Caching own icon to improve dashboard loading speed, as well as browserAction API
 * (e.g. Chrome wastes 40ms in our extension's process to read 4 icons for every tab). */
const iconCache = {};

// Firefox Android does not support such APIs, use noop

const browserAction = (() => {
  // Using `chrome` namespace in order to skip our browser.js polyfill in Chrome
  const api = chrome.browserAction;
  // Suppress the "no tab id" error when setting an icon/badge as it cannot be reliably prevented
  const ignoreErrors = () => chrome.runtime.lastError;
  // Some methods like setBadgeText added callbacks only in Chrome 67+.
  const makeMethod = fn => (...args) => {
    try {
      api::fn(...args, ignoreErrors);
    } catch (e) {
      api::fn(...args);
    }
  };
  return objectPick(api, [
    'setIcon',
    'setBadgeText',
    'setBadgeBackgroundColor',
    'setTitle',
  ], fn => (fn ? makeMethod(fn) : noop));
})();

const badges = {};
const KEY_IS_APPLIED = 'isApplied';
const KEY_SHOW_BADGE = 'showBadge';
const KEY_BADGE_COLOR = 'badgeColor';
const KEY_BADGE_COLOR_BLOCKED = 'badgeColorBlocked';
/** @type {boolean} */
let isApplied;
/** @type {VMBadgeMode} */
let showBadge;
/** @type {string} */
let badgeColor;
/** @type {string} */
let badgeColorBlocked;
/** @type {string} */
let titleBlacklisted;
/** @type {string} */
let titleNoninjectable;

hookOptions((changes) => {
  let v;
  const jobs = [];
  if ((v = changes[KEY_IS_APPLIED]) != null) {
    isApplied = v;
    setIcon(); // change the default icon
    jobs.push(setIcon); // change the current tabs' icons
  }
  if ((v = changes[KEY_SHOW_BADGE]) != null) {
    showBadge = v;
    jobs.push(updateBadge);
  }
  if ((v = changes[KEY_BADGE_COLOR]) && (badgeColor = v)
  || (v = changes[KEY_BADGE_COLOR_BLOCKED]) && (badgeColorBlocked = v)) {
    jobs.push(updateBadgeColor);
  }
  if (BLACKLIST in changes) {
    jobs.push(updateState);
  }
  if (jobs.length) {
    forEachTab(tab => jobs.forEach(fn => fn(tab)));
  }
});

postInitialize.push(() => {
  isApplied = getOption(KEY_IS_APPLIED);
  showBadge = getOption(KEY_SHOW_BADGE);
  badgeColor = getOption(KEY_BADGE_COLOR);
  badgeColorBlocked = getOption(KEY_BADGE_COLOR_BLOCKED);
  titleBlacklisted = i18n('failureReasonBlacklisted');
  titleNoninjectable = i18n('failureReasonNoninjectable');
  forEachTab(updateState);
  if (!isApplied) setIcon(); // sets the dimmed icon as default
});

browser.tabs.onRemoved.addListener((id) => {
  delete badges[id];
});

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  const { url } = info;
  if (info.status === 'loading'
      // at least about:newtab in Firefox may open without 'loading' status
      || info.favIconUrl && tab.url.startsWith('about:')) {
    updateState(tab, url);
  }
});

function setBadge(ids, { tab, frameId }) {
  const tabId = tab.id;
  const data = badges[tabId] || {};
  if (!data.idMap || frameId === 0) {
    // 1) keeping data object to preserve data.blocked
    // 2) 'total' and 'unique' must match showBadge in options-defaults.js
    data.total = 0;
    data.unique = 0;
    data.idMap = {};
    badges[tabId] = data;
  }
  data.total += ids.length;
  if (ids) {
    ids.forEach((id) => {
      data.idMap[id] = 1;
    });
    data.unique = Object.keys(data.idMap).length;
  }
  updateBadgeColor(tab, data);
  updateBadge(tab, data);
}

function updateBadge(tab, data = badges[tab.id]) {
  if (data) {
    browserAction.setBadgeText({
      text: `${data[showBadge] || ''}`,
      tabId: tab.id,
    });
  }
}

function updateBadgeColor(tab, data = badges[tab.id]) {
  if (data) {
    browserAction.setBadgeBackgroundColor({
      color: data.blocked ? badgeColorBlocked : badgeColor,
      tabId: tab.id,
    });
  }
}

// Chrome 79+ uses pendingUrl while the tab connects to the newly navigated URL
// https://groups.google.com/a/chromium.org/forum/#!topic/chromium-extensions/5zu_PT0arls
function updateState(tab, url = getTabUrl(tab)) {
  const tabId = tab.id;
  const injectable = INJECTABLE_TAB_URL_RE.test(url);
  const blacklisted = injectable ? testBlacklist(url) : undefined;
  const title = blacklisted && titleBlacklisted || !injectable && titleNoninjectable || '';
  // if the user unblacklisted this previously blocked tab in settings,
  // but didn't reload the tab yet, we need to restore the icon and the title
  if (title || (badges[tabId] || {}).blocked) {
    // Firefox Android doesn't fall back on empty values
    browserAction.setTitle({ title: title || i18n('extName'), tabId });
    const data = title ? { blocked: true } : {};
    badges[tabId] = data;
    setIcon(tab, data);
    updateBadge(tab, data);
  }
}

async function setIcon(tab = {}, data = {}) {
  const mod = data.blocked && 'b' || !isApplied && 'w' || '';
  const pathData = {};
  const iconData = {};
  for (const n of SIZES) {
    const path = new URL(`${ICON_PREFIX}${n}${mod}.png`).pathname;
    const icon = await getOwnIcon(path);
    pathData[n] = path;
    iconData[n] = icon.img;
  }
  // imageData doesn't work in Firefox Android, so we also set path here
  browserAction.setIcon({
    tabId: tab.id,
    path: pathData,
    imageData: iconData,
  });
}

function getOwnIcon(path) {
  const icon = iconCache[path] || (iconCache[path] = loadImageData(path));
  return icon;
}

/**
 * @param {string} path must be a relative path in Firefox Android
 * @throws in Firefox when Canvas is disabled by something in about:config
 */
function loadImageData(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      const { width, height } = img;
      if (!width) { // FF reports 0 for SVG
        resolve({ uri: path });
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(iconCache[path] = {
        uri: canvas.toDataURL(),
        img: ctx.getImageData(0, 0, width, height),
      });
    };
    img.onerror = reject;
  });
}
