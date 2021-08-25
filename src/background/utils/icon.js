import { i18n, noop } from '#/common';
import ua from '#/common/ua';
import { INJECTABLE_TAB_URL_RE } from '#/common/consts';
import { objectPick } from '#/common/object';
import cache from './cache';
import { postInitialize } from './init';
import { commands, forEachTab } from './message';
import { getOption, hookOptions } from './options';
import { testBlacklist } from './tester';

// storing in `cache` only for the duration of page load in case there are 2+ identical urls
const CACHE_DURATION = 1000;

Object.assign(commands, {
  async GetImageData(url) {
    const key = `GetImageData:${url}`;
    return cache.get(key)
      || cache.put(key, loadImageData(url, { base64: true }).catch(noop), CACHE_DURATION);
  },
  SetBadge: setBadge,
});

// Firefox Android does not support such APIs, use noop

const browserAction = (() => {
  const api = browser.browserAction;
  // Suppress the "no tab id" error when setting an icon/badge as it cannot be reliably prevented
  const ignoreErrors = () => global.chrome.runtime.lastError;
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
/** @type boolean */
let isApplied;
/** @type VMBadgeMode */
let showBadge;
/** @type string */
let badgeColor;
/** @type string */
let badgeColorBlocked;
/** @type string */
let titleBlacklisted;
/** @type string */
let titleNoninjectable;

// We'll cache the icon data in Chrome as it doesn't cache the data and takes up to 40ms
// in our background page context to set the 4 icon sizes for each new tab opened
const iconCache = ua.isChrome && {};

hookOptions((changes) => {
  let v;
  if ((v = changes[KEY_IS_APPLIED]) != null) {
    isApplied = v;
    setIcon(); // change the default icon
    forEachTab(setIcon); // change the current tabs' icons
  }
  if ((v = changes[KEY_SHOW_BADGE]) != null) {
    showBadge = v;
    forEachTab(updateBadge);
  }
  if ((v = changes[KEY_BADGE_COLOR])) {
    badgeColor = v;
    forEachTab(updateBadgeColor);
  }
  if ((v = changes[KEY_BADGE_COLOR_BLOCKED])) {
    badgeColorBlocked = v;
    forEachTab(updateBadgeColor);
  }
  if ('blacklist' in changes) {
    forEachTab(updateState);
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
function updateState(tab, url = tab.pendingUrl || tab.url) {
  const tabId = tab.id;
  const injectable = INJECTABLE_TAB_URL_RE.test(url);
  const blacklisted = injectable ? testBlacklist(url) : undefined;
  const title = blacklisted && titleBlacklisted || !injectable && titleNoninjectable || '';
  // if the user unblacklisted this previously blocked tab in settings,
  // but didn't reload the tab yet, we need to restore the icon and the title
  if (title || (badges[tabId] || {}).blocked) {
    browserAction.setTitle({ title, tabId });
    const data = title ? { blocked: true } : {};
    badges[tabId] = data;
    setIcon(tab, data);
    updateBadge(tab, data);
  }
}

async function setIcon(tab = {}, data = {}) {
  // modern Chrome and Firefox use 16/32, other browsers may still use 19/38 (e.g. Vivaldi)
  const mod = data.blocked && 'b' || !isApplied && 'w' || '';
  const iconData = {};
  for (const n of [16, 19, 32, 38]) {
    const path = `/public/images/icon${n}${mod}.png`;
    let icon = iconCache ? iconCache[path] : path;
    if (!icon) {
      icon = await loadImageData(path);
      iconCache[path] = icon;
    }
    iconData[n] = icon;
  }
  browserAction.setIcon({
    tabId: tab.id,
    [iconCache ? 'imageData' : 'path']: iconData,
  });
}

function loadImageData(path, { base64 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      const { width, height } = img;
      if (!width) { // FF reports 0 for SVG
        resolve(path);
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(base64 ? canvas.toDataURL() : ctx.getImageData(0, 0, width, height));
    };
    img.onerror = reject;
  });
}
