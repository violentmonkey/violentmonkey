import { i18n, ignoreChromeErrors, makeDataUri, noop } from '@/common';
import { BLACKLIST } from '@/common/consts';
import loadIconData from '@/common/load-icon-data';
import { addOwnCommands, commands, init } from './init';
import { installedOver } from './on-installed';
import { getOption, hookOptions, setOption } from './options';
import { popupTabs } from './popup-tracker';
import { isTopFrame } from './preinject-core';
import sessionData, { badges, flushSession, kBadges } from './session-data';
import storage, { S_CACHE } from './storage';
import { forEachTab, getTabUrl, injectableRe, openDashboard, tabsOnRemoved, tabsOnUpdated } from './tabs';
import { testBlacklist } from './tester';
import { CMD_PREFIX, contextMenus, handlePageMenuCommand } from './page-menu-commands';
import { FIREFOX, ua } from './ua';

/** 1x + HiDPI 1.5x, 2x */
const SIZES = !FIREFOX
  ? [16, 32]
  : ua.mobile
    ? [32, 38, 48] // 1x, 1.5x, 2x
    : [16, 32, 48, 64]; // 16+32: toolbar, 32+48+64: extensions panel
/** Caching own icon to improve dashboard loading speed, as well as browserAction API
 * (e.g. Chrome wastes 40ms in our extension's process to read 4 icons for every tab). */
const iconCache = {};
const iconDataCache = {};
/** @return {string | Promise<string>} */
export const getImageData = url => iconCache[url] || (iconCache[url] = loadIcon(url));
// Firefox Android does not support such APIs, use noop
const browserAction = browser[__.MV3 ? 'action' : 'browserAction'];
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
  if (!sessionData.init) {
    forEachTab(updateState);
    if (!isApplied) setIcon(); // sets the dimmed icon as default
  }
  if (contextMenus && (!__.MV3 || installedOver)) {
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
    if (__.MV3 && __.DEV) await addToIcon('reload', 'Reload extension');
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

contextMenus?.onClicked.addListener(async ({ menuItemId: id, frameId }, tab) => {
  if (init) await init;
  if (!id.startsWith(CMD_PREFIX) || !handlePageMenuCommand(id, tab, frameId)) {
    handleHotkeyOrMenu(id, tab);
  }
});
tabsOnRemoved.addListener(async id => {
  if (init) await init;
  delete badges[id];
  if (__.MV3) flushSession(kBadges, badges);
});
if (__.MV3) {
  chrome.webNavigation.onCommitted.addListener(info => {
    if (isTopFrame(info) && info.documentLifecycle !== 'prerender') {
      onTabUpdated(info.tabId, info);
    }
  }, {
    // A webpage may be navigated to a non-injectable page so we need to reset the badge.
    // Listing the schemes explicitly to exclude detached devtools windows.
    url: [{ schemes: ['http', 'https', 'file', 'chrome', 'chrome-extension'] }],
  });
}
tabsOnUpdated.addListener(onTabUpdated, FIREFOX && { properties: ['status'] });

/**
 * @param {number} tabId
 * @param {browser.tabs._OnUpdatedChangeInfo} change
 * @param {chrome.tabs.Tab} [tab] not present when called from webNavigation.onCommitted
 */
async function onTabUpdated(tabId, { url, status }, tab) {
  if (init) await init;
  const loading = status === 'loading';
  const title = !(__.MV3 && tab && loading) // skip "loading": in MV3 we use onCommitted
    && (url ||= tab && getTabUrl(tab)) // when tab is reloaded there's no change of url
    && getFailureReason(url)[0];
  // A known failure reason or no script ran since tab started to load
  if (title || status === 'complete' && !badges[tabId]) {
    updateState(
      tab || { id: tabId },
      resetBadgeData(tabId, title ? null : undefined),
      title,
    );
  } else if (__.MV3 && !tab/*onCommitted*/ && badges[tabId]) {
    // Resetting, but not updating the UI yet, waiting for scripts to run or tab load
    delete badges[tabId];
    flushSession(kBadges, badges);
  }
}

function resetBadgeData(tabId, isInjected) {
  // 'total' and 'unique' must match showBadge in options-defaults.js
  const data = badges[tabId] ||= /** @type {VMBadgeData} */{};
  data.icon = iconDefault;
  data.total = 0;
  data.unique = 0;
  data[IDS] = [];
  data[kFrameId] = undefined;
  data[INJECT] = isInjected;
  // Notify popup about non-injectable tab
  if (!isInjected) popupTabs[tabId]?.postMessage(null);
  if (__.MV3) flushSession(kBadges, badges);
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
    for (const id of ids) {
      if (!idMap.includes(id)) idMap.push(id);
    }
    data.unique = idMap.length;
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
    }).catch(noop);
  }
}

function updateBadgeColor({ id: tabId }, data = badges[tabId]) {
  if (data) {
    browserAction.setBadgeBackgroundColor({
      color: data[INJECT] ? badgeColor : badgeColorBlocked,
      tabId,
    }).catch(noop);
  }
}

function updateState(tab, data, title) {
  const tabId = tab.id;
  if (!data) data = badges[tabId] || resetBadgeData(tabId);
  if (!title) [title] = getFailureReason(getTabUrl(tab), data);
  browserAction.setTitle({ tabId, title }).catch(noop);
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
  }).catch(noop);
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
  } else if (id === 'reload') {
    chrome.runtime.reload();
  } else if (id === 'toggleInjection') {
    setOption(IS_APPLIED, !isApplied);
  } else if (id === 'updateScripts') {
    commands.CheckUpdate();
  } else if (id === 'updateScriptsInTab') {
    id = badges[tab.id]?.[IDS];
    if (id) commands.CheckUpdate({ ids: id });
  } else if (id.startsWith(KEY_SHOW_BADGE)) {
    setOption(KEY_SHOW_BADGE, id.slice(KEY_SHOW_BADGE.length + 1));
  }
}

async function loadIcon(url) {
  const isOwn = url.startsWith(ICON_PREFIX);
  if (!isOwn && !(url = makeDataUri(url[0] === 'i' ? url : await loadStorageCache(url)))) {
    // not saving to iconCache[url] because it may be a temporary network problem
    return;
  }
  const [res, imageData] = await loadIconData(url, isOwn);
  if (isOwn) iconDataCache[url] = imageData;
  iconCache[url] = res;
  return res;
}

async function loadStorageCache(url) {
  return await storage[S_CACHE].getOne(url)
    ?? await storage[S_CACHE].fetch(url).catch(console.warn);
}
