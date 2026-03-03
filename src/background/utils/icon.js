import { i18n, ignoreChromeErrors, makeDataUri, noop } from '@/common';
import { BLACKLIST } from '@/common/consts';
import { nest, objectPick } from '@/common/object';
import optionsDefaults from '@/common/options-defaults';
import { getAlertsBadgeState, hookAlerts } from './alerts';
import { addOwnCommands, commands, init } from './init';
import { getOption, hookOptions, setOption } from './options';
import { popupTabs } from './popup-tracker';
import storage, { S_CACHE } from './storage';
import { forEachTab, getTabUrl, injectableRe, openDashboard, tabsOnRemoved, tabsOnUpdated } from './tabs';
import { testBlacklist } from './tester';
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
const canRasterizeIcons = typeof Image === 'function'
  && typeof document !== 'undefined'
  && !!document.createElement;
const CALLBACK_UNSUPPORTED_RE = /no matching signature|too many arguments/i;
/** @return {string | Promise<string>} */
export const getImageData = url => iconCache[url] || (iconCache[url] = loadIcon(url));
// Firefox Android does not support such APIs, use noop
const browserAction = (() => {
  // Using `chrome` namespace in order to skip our browser.js polyfill in Chrome
  const api = chrome.action || chrome.browserAction;
  // Some methods like setBadgeText added callbacks only in Chrome 67+.
  const makeMethod = fn => (...args) => {
    try {
      // Suppress the "no tab id" error when setting an icon/badge as it cannot be reliably prevented.
      const res = api::fn(...args, ignoreChromeErrors);
      res?.catch?.(ignoreChromeErrors);
    } catch (e) {
      if (CALLBACK_UNSUPPORTED_RE.test(e?.message || '')) {
        const res = api::fn(...args);
        res?.catch?.(ignoreChromeErrors);
      } else if (process.env.DEBUG) {
        console.warn('browser action call failed', e);
      }
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
const DEFAULT_SHOW_BADGE = optionsDefaults[KEY_SHOW_BADGE];
const DEFAULT_BADGE_COLOR = optionsDefaults[KEY_BADGE_COLOR];
const DEFAULT_BADGE_COLOR_BLOCKED = optionsDefaults[KEY_BADGE_COLOR_BLOCKED];
const DUPLICATE_MENU_ID_RE = /duplicate id/i;
const actionManifest = extensionManifest[BROWSER_ACTION] || {};
const titleBlacklisted = i18n('failureReasonBlacklisted');
const titleDefault = actionManifest.default_title || extensionManifest.name;
const iconDefault = (actionManifest.default_icon?.[16] || 'public/images/icon16b.png').match(/\d+(\w*)\./)[1];
const titleDisabled = i18n('menuScriptDisabled');
const titleNoninjectable = i18n('failureReasonNoninjectable');
const titleSkipped = i18n('skipScriptsMsg');
const ALERT_BADGE_TEXT = '•';
const ALERT_BADGE_COLOR = '#d93025';
const LAST_RESORT_BADGE_COLOR = '#888888';
let isApplied;
/** @type {VMBadgeMode} */
let showBadge = DEFAULT_SHOW_BADGE;
let badgeColor = DEFAULT_BADGE_COLOR;
let badgeColorBlocked = DEFAULT_BADGE_COLOR_BLOCKED;

addOwnCommands({
  GetImageData: getImageData,
});

hookOptions((changes) => {
  let v;
  const jobs = [];
  if ((v = changes[IS_APPLIED]) != null) {
    isApplied = v;
    setIcon(); // change the default icon
    jobs.push((tab) => {
      const data = badges[tab.id];
      // A tab loaded while disabled may keep a stale "off" marker until the next top-frame run.
      // Clear it when re-enabling so popup/title state reflects the global toggle immediately.
      if (v && data?.[INJECT] === 'off') {
        data[INJECT] = null;
      }
      updateState(tab, data);
    });
  }
  if ((v = changes[KEY_SHOW_BADGE]) != null) {
    showBadge = v;
    jobs.push(updateBadge);
    contextMenus?.update(KEY_SHOW_BADGE + ':' + showBadge, {checked: true});
  }
  if ((v = changes[KEY_BADGE_COLOR]) != null) {
    badgeColor = v || DEFAULT_BADGE_COLOR;
    jobs.push(updateBadgeColor);
  } else if ((v = changes[KEY_BADGE_COLOR_BLOCKED]) != null) {
    badgeColorBlocked = v || DEFAULT_BADGE_COLOR_BLOCKED;
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
  showBadge = getOption(KEY_SHOW_BADGE) ?? DEFAULT_SHOW_BADGE;
  badgeColor = getOption(KEY_BADGE_COLOR) || DEFAULT_BADGE_COLOR;
  badgeColorBlocked = getOption(KEY_BADGE_COLOR_BLOCKED) || DEFAULT_BADGE_COLOR_BLOCKED;
  forEachTab(updateState);
  if (!isApplied) setIcon(); // sets the dimmed icon as default
  if (contextMenus) {
    await new Promise(resolve => {
      if (!contextMenus.removeAll) {
        resolve();
        return;
      }
      try {
        contextMenus.removeAll(() => {
          ignoreChromeErrors();
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
    const addToIcon = (id, title, opts) => (
      new Promise(resolve => {
        let retried;
        const details = {
          contexts: [BROWSER_ACTION],
          id,
          title,
          ...opts,
        };
        const create = () => {
          contextMenus.create(details, () => {
            const err = chrome.runtime.lastError;
            if (err && !retried && DUPLICATE_MENU_ID_RE.test(err.message || '')
            && contextMenus.remove) {
              retried = true;
              contextMenus.remove(id, () => {
                ignoreChromeErrors();
                create();
              });
              return;
            }
            // Read and clear runtime.lastError in all cases to suppress console noise.
            if (err) ignoreChromeErrors();
            resolve();
          });
        };
        create();
      })
    );
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
hookAlerts(() => {
  forEachTab(tab => {
    updateBadge(tab);
    updateBadgeColor(tab);
  });
});

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
    const alertState = getAlertsBadgeState();
    browserAction.setBadgeText({
      text: alertState.show ? ALERT_BADGE_TEXT : `${data[showBadge] || ''}`,
      tabId,
    });
  }
}

function updateBadgeColor({ id: tabId }, data = badges[tabId]) {
  if (data) {
    const alertState = getAlertsBadgeState();
    const color = (alertState.show ? ALERT_BADGE_COLOR
      : data[INJECT] ? badgeColor || DEFAULT_BADGE_COLOR
        : badgeColorBlocked || DEFAULT_BADGE_COLOR_BLOCKED)
      || LAST_RESORT_BADGE_COLOR;
    browserAction.setBadgeBackgroundColor({
      color,
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
  let hasImageData = true;
  for (const n of SIZES) {
    const url = `${ICON_PREFIX}${n}${mod}.png`;
    pathData[n] = url;
    const imageData = iconDataCache[url]
      || await (iconCache[url] || (iconCache[url] = loadIcon(url))) && iconDataCache[url];
    if (imageData) {
      iconData[n] = imageData;
    } else {
      hasImageData = false;
    }
  }
  // imageData doesn't work in Firefox Android, so we also set path here
  const payload = {
    tabId,
    path: pathData,
  };
  if (hasImageData) {
    payload.imageData = iconData;
  }
  browserAction.setIcon(payload);
}

/** Omitting `data` = check whether injection is allowed for `url` */
export function getFailureReason(url, data, def = titleDefault) {
  const applied = isApplied ?? getOption(IS_APPLIED);
  return !injectableRe.test(url) ? [titleNoninjectable, INJECT_INTO]
    : ((url = testBlacklist(url))) ? [titleBlacklisted, 'blacklisted', url]
      : !applied || data?.[INJECT] === 'off' ? [titleDisabled, IS_APPLIED]
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
  } else if (id === 'toggleInjection') {
    setOption(IS_APPLIED, !isApplied);
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
  const isOwn = url.startsWith(ICON_PREFIX);
  const src = isOwn ? url.slice(extensionOrigin.length) // must be a relative path in Firefox Android
    : url.startsWith('data:') ? url
      : makeDataUri(url[0] === 'i' ? url : await loadStorageCache(url))
        || url;
  if (!canRasterizeIcons) {
    iconCache[url] = src;
    return src;
  }
  const img = new Image();
  img.src = src;
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
