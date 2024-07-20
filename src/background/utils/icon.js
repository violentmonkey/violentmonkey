import { i18n, ignoreChromeErrors, makeDataUri, noop } from '@/common';
import { BLACKLIST } from '@/common/consts';
import { nest, objectPick } from '@/common/object';
import { addOwnCommands, commands, init } from './init';
import { getOption, hookOptions, setOption } from './options';
import { popupTabs } from './popup-tracker';
import storage, { S_CACHE } from './storage';
import { forEachTab, getTabUrl, injectableRe, openDashboard, tabsOnRemoved, tabsOnUpdated } from './tabs';
import { testBlacklist } from './tester';
import { FIREFOX } from './ua';

/** We don't set 19px because FF and Vivaldi scale it down to 16px instead of our own crisp 16px */
const SIZES = [16, 32];
/** Caching own icon to improve dashboard loading speed, as well as browserAction API
 * (e.g. Chrome wastes 40ms in our extension's process to read 4 icons for every tab). */
const iconCache = {};
const iconDataCache = {};
/** @return {string | Promise<string>} */
export const getImageData = url => iconCache[url] || (iconCache[url] = loadIcon(url));
// Firefox Android does not support such APIs, use noop
const browserAction = (() => {
  // Using `chrome` namespace in order to skip our browser.js polyfill in Chrome
  const api = chrome.browserAction;
  // Some methods like setBadgeText added callbacks only in Chrome 67+.
  const makeMethod = fn => (...args) => {
    try {
      // Suppress the "no tab id" error when setting an icon/badge as it cannot be reliably prevented
      api::fn(...args, ignoreChromeErrors);
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
// Promisifying explicitly because this API returns an id in Firefox and not a Promise
const contextMenus = chrome.contextMenus;

/** @type {{ [tabId: string]: VMBadgeData }}*/
export const badges = {};
const KEY_SHOW_BADGE = 'showBadge';
const KEY_BADGE_COLOR = 'badgeColor';
const KEY_BADGE_COLOR_BLOCKED = 'badgeColorBlocked';
const titleBlacklisted = i18n('failureReasonBlacklisted');
const titleDefault = extensionManifest[BROWSER_ACTION].default_title;
const iconDefault = extensionManifest[BROWSER_ACTION].default_icon[16].match(/\d+(\w*)\./)[1];
const titleDisabled = i18n('menuScriptDisabled');
const titleNoninjectable = i18n('failureReasonNoninjectable');
const titleSkipped = i18n('skipScriptsMsg');
let isApplied;
/** @type {VMBadgeMode} */
let showBadge;
let badgeColor;
let badgeColorBlocked;

addOwnCommands({
  GetImageData: getImageData,
});

hookOptions((changes) => {
  let v;
  const jobs = [];
  if ((v = changes[IS_APPLIED]) != null) {
    isApplied = v;
    setIcon(); // change the default icon
    jobs.push(setIcon); // change the current tabs' icons
  }
  if ((v = changes[KEY_SHOW_BADGE]) != null) {
    showBadge = v;
    jobs.push(updateBadge);
    contextMenus?.update(KEY_SHOW_BADGE + ':' + showBadge, {checked: true});
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

init.then(async () => {
  isApplied = getOption(IS_APPLIED);
  showBadge = getOption(KEY_SHOW_BADGE);
  badgeColor = getOption(KEY_BADGE_COLOR);
  badgeColorBlocked = getOption(KEY_BADGE_COLOR_BLOCKED);
  forEachTab(updateState);
  if (!isApplied) setIcon(); // sets the dimmed icon as default
  if (contextMenus) {
    const addToIcon = (id, title, opts) => (
      new Promise(resolve => (
        contextMenus.create({
          contexts: [BROWSER_ACTION],
          id,
          title,
          ...opts,
        }, resolve)
      ))
    ).then(ignoreChromeErrors);
    const badgeChild = { parentId: KEY_SHOW_BADGE, type: 'radio' };
    await addToIcon(SKIP_SCRIPTS, i18n('skipScripts'));
    for (const args of [
      [KEY_SHOW_BADGE, i18n('labelBadge')],
      [`${KEY_SHOW_BADGE}:`, i18n('labelBadgeNone'), badgeChild],
      [`${KEY_SHOW_BADGE}:unique`, i18n('labelBadgeUnique'), badgeChild],
      [`${KEY_SHOW_BADGE}:total`, i18n('labelBadgeTotal'), badgeChild],
    ]) {
      await addToIcon(...args);
    }
    contextMenus.update(KEY_SHOW_BADGE + ':' + showBadge, { checked: true });
    // Chrome already adds a built-in "Options" item
    if (IS_FIREFOX) await addToIcon(TAB_SETTINGS, i18n('labelSettings'));
  }
});

contextMenus?.onClicked.addListener(({ menuItemId: id }, tab) => {
  handleHotkeyOrMenu(id, tab);
});
tabsOnRemoved.addListener(id => delete badges[id]);
tabsOnUpdated.addListener((tabId, { url }, tab) => {
  if (url) {
    const [title] = getFailureReason(url);
    if (title) updateState(tab, resetBadgeData(tabId, null), title);
  }
}, FIREFOX && { properties: ['status'] });

function resetBadgeData(tabId, isInjected) {
  // 'total' and 'unique' must match showBadge in options-defaults.js
  /** @type {VMBadgeData} */
  const data = nest(badges, tabId);
  data.icon = iconDefault;
  data.total = 0;
  data.unique = 0;
  data[IDS] = new Set();
  data[kFrameId] = undefined;
  data[INJECT] = isInjected;
  // Notify popup about non-injectable tab
  if (!isInjected) popupTabs[tabId]?.postMessage(null);
  return data;
}

/**
 * @param {number[] | string} ids
 * @param {boolean} reset
 * @param {VMMessageSender} src
 */
export function setBadge(ids, reset, { tab, [kFrameId]: frameId, [kTop]: isTop }) {
  const tabId = tab.id;
  const injectable = ids === SKIP_SCRIPTS || ids === 'off' ? ids : !!ids;
  /** @type {VMBadgeData} */
  const data = !(reset && isTop) && badges[tabId] || resetBadgeData(tabId, injectable);
  if (Array.isArray(ids)) {
    const {
      [IDS]: idMap,
      [kFrameId]: totalMap = data[kFrameId] = {},
    } = data;
    // uniques
    ids.forEach(idMap.add, idMap);
    data.unique = idMap.size;
    // totals
    data.total = 0;
    totalMap[frameId] = ids.length;
    for (const id in totalMap) data.total += totalMap[id];
  }
  if (isTop) {
    data[INJECT] = injectable;
  }
  updateBadgeColor(tab, data);
  updateState(tab, data);
}

function updateBadge({ id: tabId }, data = badges[tabId]) {
  if (data) {
    browserAction.setBadgeText({
      text: `${data[showBadge] || ''}`,
      tabId,
    });
  }
}

function updateBadgeColor({ id: tabId }, data = badges[tabId]) {
  if (data) {
    browserAction.setBadgeBackgroundColor({
      color: data[INJECT] ? badgeColor : badgeColorBlocked,
      tabId,
    });
  }
}

function updateState(tab, data, title) {
  const tabId = tab.id;
  if (!data) data = badges[tabId] || resetBadgeData(tabId);
  if (!title) [title] = getFailureReason(getTabUrl(tab), data);
  browserAction.setTitle({ tabId, title });
  setIcon(tab, data);
  updateBadge(tab, data);
}

async function setIcon({ id: tabId } = {}, data = badges[tabId] || {}) {
  const mod = !isApplied ? 'w'
    : data[INJECT] !== true ? 'b'
      : '';
  if (data.icon === mod) return;
  data.icon = mod;
  const pathData = {};
  const iconData = {};
  for (const n of SIZES) {
    const url = `${ICON_PREFIX}${n}${mod}.png`;
    pathData[n] = url;
    iconData[n] = iconDataCache[url]
      || await (iconCache[url] || (iconCache[url] = loadIcon(url))) && iconDataCache[url];
  }
  // imageData doesn't work in Firefox Android, so we also set path here
  browserAction.setIcon({
    tabId,
    path: pathData,
    imageData: iconData,
  });
}

/** Omitting `data` = check whether injection is allowed for `url` */
export function getFailureReason(url, data, def = titleDefault) {
  return !injectableRe.test(url) ? [titleNoninjectable, INJECT_INTO]
    : ((url = testBlacklist(url))) ? [titleBlacklisted, 'blacklisted', url]
      : !isApplied || data?.[INJECT] === 'off' ? [titleDisabled, IS_APPLIED]
        : !data ? []
          : data[INJECT] === SKIP_SCRIPTS
            ? [titleSkipped, SKIP_SCRIPTS]
            : [def];
}

export function handleHotkeyOrMenu(id, tab) {
  if (id === SKIP_SCRIPTS) {
    commands[SKIP_SCRIPTS](tab);
  } else if (id === TAB_SETTINGS) {
    openDashboard(id);
  } else if (id === 'dashboard') {
    openDashboard('');
  } else if (id === 'newScript') {
    commands.OpenEditor();
  } else if (id === 'updateScripts') {
    commands.CheckUpdate();
  } else if (id === 'updateScriptsInTab') {
    id = badges[tab.id]?.[IDS];
    if (id) commands.CheckUpdate([...id]);
  } else if (id.startsWith(KEY_SHOW_BADGE)) {
    setOption(KEY_SHOW_BADGE, id.slice(KEY_SHOW_BADGE.length + 1));
  }
}

async function loadIcon(url) {
  const img = new Image();
  const isOwn = url.startsWith(ICON_PREFIX);
  img.src = isOwn ? url.slice(extensionOrigin.length) // must be a relative path in Firefox Android
    : url.startsWith('data:') ? url
      : makeDataUri(url[0] === 'i' ? url : await loadStorageCache(url));
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  });
  let res;
  let maxSize = !isOwn && (2 * 38); // dashboard icon size for 2xDPI
  let { width, height } = img;
  if (!width || !height) { // FF reports 0 for SVG
    iconCache[url] = url;
    return url;
  }
  if (maxSize && (width > maxSize || height > maxSize)) {
    maxSize /= width > height ? width : height;
    width = Math.round(width * maxSize);
    height = Math.round(height * maxSize);
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
  try {
    res = canvas.toDataURL();
    if (isOwn) iconDataCache[url] = ctx.getImageData(0, 0, width, height);
  } catch (err) {
    res = url;
  }
  iconCache[url] = res;
  return res;
}

async function loadStorageCache(url) {
  return await storage[S_CACHE].getOne(url)
    ?? await storage[S_CACHE].fetch(url, 'res').catch(console.warn);
}
