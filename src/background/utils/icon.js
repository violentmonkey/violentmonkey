import { i18n, ignoreChromeErrors, makeDataUri, noop } from '@/common';
import { BLACKLIST } from '@/common/consts';
import { nest, objectPick } from '@/common/object';
import { postInitialize } from './init';
import { addOwnCommands, addPublicCommands, forEachTab } from './message';
import { getOption, hookOptions, setOption } from './options';
import { popupTabs } from './popup-tracker';
import { INJECT, reloadAndSkipScripts } from './preinject';
import { getTabUrl, tabsOnRemoved, tabsOnUpdated } from './tabs';
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

export const badges = {};
export const BROWSER_ACTION = 'browser_action';
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
let injectableRe = /^(https?|file|ftps?):/;

if (!IS_FIREFOX) {
  chrome.extension.isAllowedFileSchemeAccess(ok => {
    if (!ok) injectableRe = /^(ht|f)tps?:/;
  });
}

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

postInitialize.push(async () => {
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
  }
});

contextMenus?.onClicked.addListener(({ menuItemId: id }, tab) => {
  if (id === SKIP_SCRIPTS) {
    reloadAndSkipScripts(tab);
  } else if (id.startsWith(KEY_SHOW_BADGE)) {
    setOption(KEY_SHOW_BADGE, id.slice(KEY_SHOW_BADGE.length + 1));
  }
});
tabsOnRemoved.addListener(id => delete badges[id]);
tabsOnUpdated.addListener((tabId, { url }, tab) => {
  if (url) {
    const [title] = getFailureReason(url);
    if (title) updateState(tab, resetBadgeData(tabId), title);
  }
}, ...IS_FIREFOX >= 61 ? [{ properties: ['status'] }] : []);

function resetBadgeData(tabId, isInjected) {
  // 'total' and 'unique' must match showBadge in options-defaults.js
  const data = nest(badges, tabId);
  data.icon = iconDefault;
  data.idMap = new Set();
  data.totalMap = {};
  data.total = 0;
  data.unique = 0;
  data[INJECT] = isInjected;
  // Notify popup about non-injectable tab
  if (!isInjected) popupTabs[tabId]?.postMessage(null);
  return data;
}

/**
 * @param {Object} params
 * @param {chrome.runtime.MessageSender} src
 */
function setBadge({ [IDS]: ids, reset }, { tab, frameId }) {
  const tabId = tab.id;
  const injectable = ids === SKIP_SCRIPTS ? SKIP_SCRIPTS : !!ids;
  const data = (frameId || !reset) && badges[tabId] || resetBadgeData(tabId, injectable);
  if (ids && ids !== SKIP_SCRIPTS) {
    const { idMap, totalMap } = data;
    // uniques
    ids.forEach(idMap.add, idMap);
    data.unique = idMap.size;
    // totals
    let total = totalMap[frameId] = ids.length;
    for (const id in totalMap) if (id !== frameId) total += totalMap[id];
    data.total = total;
  }
  data[INJECT] = injectable;
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
    const path = new URL(`${ICON_PREFIX}${n}${mod}.png`).pathname;
    const icon = await getOwnIcon(path);
    pathData[n] = path;
    iconData[n] = icon.img;
  }
  // imageData doesn't work in Firefox Android, so we also set path here
  browserAction.setIcon({
    tabId,
    path: pathData,
    imageData: iconData,
  });
}

/** Omitting `data` = check whether injection is allowed for `url` */
export function getFailureReason(url, data) {
  return !injectableRe.test(url) ? [titleNoninjectable, INJECT_INTO]
    : ((url = testBlacklist(url))) ? [titleBlacklisted, 'blacklisted', url]
      : !isApplied ? [titleDisabled, IS_APPLIED]
        : !data ? []
          : data[INJECT] === SKIP_SCRIPTS
            ? [titleSkipped, SKIP_SCRIPTS]
            : [titleDefault];
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
