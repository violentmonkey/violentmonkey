import { i18n, noop } from '#/common';
import { isChrome } from '#/common/ua';
import { INJECTABLE_TAB_URL_RE } from '#/common/consts';
import { forEachTab } from './message';
import { getOption, hookOptions } from './options';
import { testBlacklist } from './tester';

// Firefox Android does not support such APIs, use noop

const browserAction = [
  'setIcon',
  'setBadgeText',
  'setBadgeBackgroundColor',
  'setTitle',
].reduce((actions, key) => {
  const fn = browser.browserAction[key];
  actions[key] = fn ? fn.bind(browser.browserAction) : noop;
  return actions;
}, {});

const badges = {};
let isApplied;
let showBadge;
let titleBlacklisted;
let titleNoninjectable;

// We'll cache the icon data in Chrome as it doesn't cache the data and takes up to 40ms
// in our background page context to set the 4 icon sizes for each new tab opened
const iconCache = isChrome && {};

hookOptions((changes) => {
  if ('isApplied' in changes) {
    isApplied = changes.isApplied;
    setIcon();
  }
  if ('showBadge' in changes) {
    showBadge = changes.showBadge;
    forEachTab(updateBadge);
  }
  if ('blacklist' in changes) {
    forEachTab(updateState);
  }
});

global.addEventListener('backgroundInitialized', function onInit(e) {
  global.removeEventListener(e.type, onInit);
  isApplied = getOption('isApplied');
  showBadge = getOption('showBadge');
  titleBlacklisted = i18n('failureReasonBlacklisted');
  titleNoninjectable = i18n('failureReasonNoninjectable');
  forEachTab(updateState);
});

browser.tabs.onRemoved.addListener((id) => {
  delete badges[id];
});

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading'
      // at least about:newtab in Firefox may open without 'loading' status
      || info.favIconUrl && tab.url.startsWith('about:')) {
    updateState(tab, info.url);
  }
});

export function setBadge(ids, src) {
  const { id: tabId } = src.tab || {};
  const data = badges[tabId] || {};
  if (!data.idMap || src.frameId === 0) {
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
  browserAction.setBadgeBackgroundColor({
    color: data.blocked ? '#888' : '#808',
    tabId,
  });
  updateBadge(src.tab, data);
}

function updateBadge(tab, data = badges[tab.id]) {
  if (data) {
    browserAction.setBadgeText({
      text: `${data[showBadge] || ''}`,
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

function loadImageData(path) {
  return new Promise(resolve => {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      const { width, height } = img;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
  });
}
