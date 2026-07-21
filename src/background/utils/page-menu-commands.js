import { browserWindows, getActiveTab, i18n, ignoreChromeErrors, sendTabCmd } from '@/common';
import { FILE_GLOB_ALL, GLOB_ALL } from '@/common/consts';
import { forEachEntry, forEachValue } from '@/common/object';
import { kPageMenuCommands } from '@/common/options-defaults';
import { getScriptName } from '@/common/script';
import { isEmpty } from '@/common/util';
import { getScriptById } from './db';
import { addPublicCommands } from './init';
import { hookOptionsInit } from './options';
import { forEachTab, tabsOnActivated, tabsOnRemoved } from './tabs';

/**
 * ## Limitations
 * - Right-clicking a non-active tab (e.g. split view or rare UI paths) can still show commands for
 *   the active tab; fixing that without onShown would require per-URL patterns or other hacks.
 */

/** Promisified explicitly on demand because it returns an id in Firefox and not a Promise */
export const contextMenus = chrome.contextMenus;
export const CMD_PREFIX = 'cmd:';
const ROOT_ID = 'cmdRoot';
const MAX_TITLE_LEN = 250;
const SHORT_ID = Symbol('_id');
/** @type {chrome.contextMenus.CreateProperties} */
const SCOPE = {
  documentUrlPatterns: [GLOB_ALL, FILE_GLOB_ALL],
  contexts: ['all'],
};
const clipString = s => s.length <= MAX_TITLE_LEN ? s : s.slice(0, MAX_TITLE_LEN) + '...';

/** tabId for which contextMenu is currently showing commands */
let menuTabId;
/**
 * Per-tab, per-frame snapshots of `menus` from the content script (scriptId -> commandKey -> opts).
 * @type {{[tabId: string]: {[frameId: string]: {[scriptId: string]: {[menuId: string]: {
 *   menuOpts: any,
 *   SHORT_ID: string,
 * }}}}}}
 */
let tabData;
/**
 * For each tab, maps the menu command to frameId where that command was last registered.
 * Needed so sendTabCmd targets the same frame as the popup’s idMap resolution.
 * @type {{[tabId: string]: {[scriptId: string]: {[_id: string]: {
 *   [frameId: string]: boolean,
 *   SHORT_ID: string,
 * }}}}}
 */
let tabRoutes;
let submenuIds;

addPublicCommands({
  SetMenus: setMenus,
});

export function setMenus(menus, { tab, [kFrameId]: frameId, [kTop]: isTop }, reset) {
  if (!tabData || tab?.id == null) {
    return;
  }
  const tabId = tab.id;
  const routes = tabRoutes[tabId] ??= {};
  const byTab = tabData[tabId] ??= {};
  if (typeof menus === 'string') {
    menus = JSON.parse(menus);
  }
  if (isEmpty(menus)) {
    if (reset && isTop) {
      delete tabData[tabId];
      delete tabRoutes[tabId];
    } else {
      delete byTab[frameId];
      if (isEmpty(byTab)) {
        delete tabData[tabId];
        delete tabRoutes[tabId];
      }
    }
  } else {
    byTab[frameId]::forEachEntry(([scriptId, hub]) => {
      hub::forEachValue(item => {
        let r;
        if ((r = routes[scriptId]) && (r = r[item[SHORT_ID]]) && r[frameId]) {
          delete r[frameId];
        }
      });
    });
    byTab[frameId] = menus;
    menus::forEachEntry(([scriptId, hub]) => {
      for (const key in hub) {
        const item = hub[key];
        const _id = item[SHORT_ID] = Math.random().toString(36).slice(2);
        const scriptRoutes = routes[scriptId] ??= {};
        const cmdRoutes = scriptRoutes[_id] ??= { [SHORT_ID]: key };
        cmdRoutes[frameId] = true;
      }
    });
  }
  rebuildForActiveTab(undefined, tabId);
}

export function addMenuConfig(data) {
  data[kUseMenu] = !!tabData;
}

/**
 * Handles context menu clicks for ids created by rebuildPageCommandMenuTab.
 * Security: encTabId must equal tab.id from the browser (prevents cross-tab id spoofing).
 *
 * @param {string|number} id
 * @param {chrome.tabs.Tab} tab
 * @param {number} frameId
 * @returns {boolean?} true if handled
 */
export function handlePageMenuCommand(id, { id: tabId }, frameId) {
  if (!tabData) {
    return;
  }
  const [/*prefix*/, sTabId, sScriptId, _id] = id.split(':');
  if (+sTabId !== tabId) {
    return;
  }
  const routes = tabRoutes[sTabId]?.[sScriptId]?.[_id];
  if (!routes || !routes[frameId] && !routes[frameId = +Object.keys(routes)[0]]) {
    return;
  }
  // Synthetic event so injected Command handler runs like a context-menu activation from the popup.
  return sendTabCmd(tabId, 'Command', {
    id: +sScriptId,
    key: routes[SHORT_ID],
    evt: {
      type: 'mouseup',
      button: 2,
    },
  }, frameId == null ? undefined : { [kFrameId]: frameId });
}

function onTabRemoved(tabId) {
  if (!tabData) return;
  delete tabData[tabId];
  delete tabRoutes[tabId];
}

function onTabActivated({ tabId }) {
  if (!tabData || tabId === menuTabId) return;
  rebuildPageCommandMenuTab(tabId);
}

async function onFocusChanged(windowId) {
  if (!tabData || windowId < 0) return;
  rebuildForActiveTab(windowId);
}

if (contextMenus) {
  hookOptionsInit(({ [kPageMenuCommands]: state }, firstRun) => {
    if (state != null && state !== !!tabData) {
      setEnabled(state);
      if (!firstRun) forEachTab(sendTabCmd, kUseMenu, state);
    }
  });
}

/**
 * Replace dynamic submenus for `tabId`: root → script submenu → command rows.
 * We hide the root when there are no commands for this tab.
 */
function rebuildPageCommandMenuTab(tabId) {
  if (!tabData || !submenuIds || tabId == null) {
    return;
  }
  removeSubMenus();
  const merged = {};
  tabData[tabId]::forEachValue(byFrame => {
    for (const scriptId in byFrame) {
      Object.assign(merged[scriptId] ??= {}, byFrame[scriptId]);
    }
  });
  let commandCount = 0;
  for (const scriptId in merged) {
    const hub = merged[scriptId];
    const script = getScriptById(scriptId);
    const subId = `${tabId}:${scriptId}`;
    contextMenus.create({
      id: subId,
      parentId: ROOT_ID,
      title: (script?.config.enabled ? '' : '⛔ ')
        + (script ? clipString(getScriptName(script)) : `#${scriptId}`),
      ...SCOPE,
    }, ignoreChromeErrors);
    submenuIds.push(subId);
    for (const key in hub) {
      const item = hub[key];
      const id = `${CMD_PREFIX}${subId}:${item[SHORT_ID]}`;
      contextMenus.create({
        id,
        parentId: subId,
        title: clipString(item.text || ''),
        ...SCOPE,
      }, ignoreChromeErrors);
      commandCount += 1;
    }
  }
  contextMenus.update(ROOT_ID, { visible: commandCount > 0 }, ignoreChromeErrors);
  menuTabId = tabId;
}

async function rebuildForActiveTab(windowId, updatedTabId) {
  const t = await getActiveTab(windowId);
  if (t && (
    updatedTabId == null
      ? t.id !== menuTabId // already prepared
      : t.id === updatedTabId
  )) {
    rebuildPageCommandMenuTab(t.id);
  }
}

function removeSubMenus() {
  if (submenuIds) {
    for (const id of submenuIds) {
      contextMenus.remove(id, ignoreChromeErrors);
    }
  }
  submenuIds = tabData && [];
}

function setEnabled(value) {
  menuTabId = null; // to re-create the menu
  tabData = value && {};
  tabRoutes = value && {};
  const onOff = value ? 'addListener' : 'removeListener';
  browserWindows?.onFocusChanged[onOff](onFocusChanged);
  tabsOnActivated[onOff](onTabActivated);
  tabsOnRemoved[onOff](onTabRemoved);
  if (!tabData) {
    if (submenuIds) {
      removeSubMenus();
      contextMenus.remove(ROOT_ID, ignoreChromeErrors);
    }
    return;
  }
  if (!submenuIds) {
    contextMenus.create({
      id: ROOT_ID,
      title: i18n('extName'),
      visible: false,
      ...SCOPE,
    }, ignoreChromeErrors);
    submenuIds = [];
  }
  rebuildForActiveTab();
}
