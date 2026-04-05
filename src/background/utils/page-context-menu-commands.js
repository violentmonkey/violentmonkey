import { browserWindows, getActiveTab, i18n, ignoreChromeErrors, isEmpty, sendTabCmd } from '@/common';
import { browser } from '@/common/consts';
import { nest } from '@/common/object';
import { kFrameId } from '@/common/safe-globals';
import { addPublicCommands, init } from './init';
import { tabsOnActivated, tabsOnRemoved } from './tabs';
import { getScriptById } from './db';

/**
 * Page / frame context menu entries for GM_registerMenuCommand.
 *
 * ## End-to-end flow
 * 1. A userscript calls GM_registerMenuCommand in the injected (page) world; the content script
 *    keeps a `menus` map and notifies the background via UpdateTabMenuCommands (see gm-api-content).
 * 2. This module stores that snapshot per (tabId, frameId), merges frames like the popup does, and
 *    mirrors the merged commands as children under a fixed parent item (VM_PAGE_CMD_ROOT).
 * 3. When the user picks an entry, contextMenus.onClicked runs; icon.js delegates here by id prefix.
 *    We verify the tab id baked into the item id matches the tab Chrome passed to onClicked, then
 *    sendTabCmd(..., 'Command', ...) to the frame that registered that command so the same callback
 *    runs as from the extension popup.
 *
 * ## Why we rebuild the menu instead of using contextMenus.onShown
 * Chrome’s chrome.contextMenus API does not expose onShown. Firefox has menus.onShown, but we target
 * Chrome as well. The extension context menu is global (not per-tab in the API), so we maintain one
 * set of dynamic items that we remove/recreate whenever the “display target” tab should change.
 *
 * ## What tab the menu represents (approximation)
 * We rebuild so the list matches the active tab of the focused browser window most of the time:
 * - tabs.onActivated: user switched tab inside a window.
 * - windows.onFocusChanged: user focused another window; we query that window’s active tab.
 * - UpdateTabMenuCommands: if the tab that changed is the current getActiveTab(), refresh the list.
 * - tabs.onUpdated (url): cleared script state for that tab; refresh if it was the active tab.
 * - tabs.onRemoved: drop that tab’s data; rebuild for whichever tab is active now.
 * - init: after creating the root item, one getActiveTab() so startup isn’t empty until a tab switch.
 *
 * ## Limitations
 * - Right-clicking a non-active tab (e.g. split view or rare UI paths) can still show commands for
 *   the active tab; fixing that without onShown would require per-URL patterns or other hacks.
 * - Service worker restarts drop in-memory tabFrameMenus/routeTab until scripts call
 *   GM_registerMenuCommand again (same class of issue as other ephemeral BG state).
 * - Menu item ids embed tabId + scriptId + key; encodeURIComponent(key) keeps odd keys safe.
 * - Per-script submenu (script display name) groups command captions; Chrome removes child items when
 *   the submenu id is removed.
 * - When a script is disabled or removed (db.updateScriptInfo), BG purges cached menus for all tabs/
 *   frames and tabs get PurgeScriptMenus so the popup’s menus map stays in sync.
 */

const contextMenus = chrome.contextMenus;

const VM_PAGE_CMD_ROOT = 'vmPageCmdRoot';
const VM_SCRIPT_SUB_PREFIX = 'vmScriptSub:';
const CMD_PREFIX = 'vmCmd:';
const MAX_TITLE_LEN = 250;

/** Per-tab, per-frame snapshots of `menus` from the content script (scriptId -> commandKey -> opts). */
const tabFrameMenus = {};
/**
 * For each tab, maps `${scriptId}:${commandKey}` -> frameId where that command was last registered.
 * Needed so sendTabCmd targets the same frame as the popup’s idMap resolution.
 */
const routeTab = {};
/** Script submenu ids under VM_PAGE_CMD_ROOT (removing an id drops its command children too). */
let dynamicSubmenuIds = [];

/** Merge all frames’ menu snapshots for one tab; later frame ids overwrite same script/command keys. */
function mergeTabMenus(tabId) {
  const byFrame = tabFrameMenus[tabId];
  if (!byFrame) return Object.create(null);
  const frameIds = Object.keys(byFrame).map(Number);
  const merged = Object.create(null);
  for (const fid of frameIds) {
    const m = byFrame[fid];
    if (!m) continue;
    for (const sid in m) {
      const hub = merged[sid] || (merged[sid] = Object.create(null));
      Object.assign(hub, m[sid]);
    }
  }
  return merged;
}

/** Command row title (script name is the parent submenu). */
function formatCommandTitle(item) {
  const s = item.text || '';
  return s.length > MAX_TITLE_LEN ? `${s.slice(0, MAX_TITLE_LEN - 1)}...` : s;
}

/** Submenu title from first registered command’s displayName, or fallback. */
function formatScriptSubmenuTitle(hub, scriptId) {
  for (const key in hub) {
    const name = hub[key]?.displayName;
    if (name) {
      const s = `${name}`;
      return s.length > MAX_TITLE_LEN ? `${s.slice(0, MAX_TITLE_LEN - 1)}...` : s;
    }
  }
  const fb = `#${scriptId}`;
  return fb.length > MAX_TITLE_LEN ? `${fb.slice(0, MAX_TITLE_LEN - 1)}...` : fb;
}

/**
 * Replace dynamic submenus for `tabId`: root → script submenu → command rows.
 * We hide the root when there are no commands for this tab.
 */
function rebuildPageCommandMenuTab(tabId) {
  if (!contextMenus || tabId == null) return;
  for (const id of dynamicSubmenuIds) {
    contextMenus.remove(id, ignoreChromeErrors);
  }
  dynamicSubmenuIds = [];
  const merged = mergeTabMenus(tabId);
  let commandCount = 0;
  for (const scriptId in merged) {
    const hub = merged[scriptId];
    const script = getScriptById(scriptId);
    let title = formatScriptSubmenuTitle(hub, scriptId);
    if (!script?.config.enabled) {
      title = `⛔ ${title}`;
    }
    const subId = `${VM_SCRIPT_SUB_PREFIX}${tabId}:${scriptId}`;
    contextMenus.create({
      id: subId,
      parentId: VM_PAGE_CMD_ROOT,
      title,
      contexts: ['page', 'frame'],
    }, ignoreChromeErrors);
    dynamicSubmenuIds.push(subId);
    for (const key in hub) {
      const item = hub[key];
      const id = `${CMD_PREFIX}${tabId}:${scriptId}:${encodeURIComponent(key)}`;
      contextMenus.create({
        id,
        parentId: subId,
        title: formatCommandTitle(item),
        contexts: ['page', 'frame'],
      }, ignoreChromeErrors);
      commandCount += 1;
    }
  }
  contextMenus.update(VM_PAGE_CMD_ROOT, { visible: commandCount > 0 }, ignoreChromeErrors);
}

/** If the tab whose menus changed is the active tab (current window), refresh visible context items. */
function maybeRebuildForActiveTab(updatedTabId) {
  getActiveTab().then((active) => {
    if (active?.id === updatedTabId) rebuildPageCommandMenuTab(updatedTabId);
  });
}

addPublicCommands({
  /** Sync in-memory menu state from a content-script frame; see file comment for merge/routing rules. */
  UpdateTabMenuCommands(menus, { tab, [kFrameId]: frameId, [kTop]: isTop }) {
    if (!tab?.id) return;
    const routes = nest(routeTab, tab.id);
    const byTab = nest(tabFrameMenus, tab.id);
    if (isEmpty(menus)) {
      if (isTop) {
        delete tabFrameMenus[tab.id];
        delete routeTab[tab.id];
      } else {
        delete byTab[frameId];
        if (isEmpty(byTab)) {
          delete tabFrameMenus[tab.id];
          delete routeTab[tab.id];
        }
      }
    } else {
      const oldFrameMenus = byTab[frameId];
      if (oldFrameMenus) {
        for (const sid in oldFrameMenus) {
          for (const key in oldFrameMenus[sid]) {
            const rkey = `${sid}:${key}`;
            if (routes[rkey] === frameId) delete routes[rkey];
          }
        }
      }
      byTab[frameId] = menus;
      for (const sid in menus) {
        for (const key in menus[sid]) {
          routes[`${sid}:${key}`] = frameId;
        }
      }
    }
    maybeRebuildForActiveTab(tab.id);
  },
});

// Drop closed tab’s state, then repoint the global menu at the new active tab (if any).
tabsOnRemoved.addListener((tabId) => {
  delete tabFrameMenus[tabId];
  delete routeTab[tabId];
  getActiveTab().then((active) => {
    if (active?.id != null) rebuildPageCommandMenuTab(active.id);
  });
});

// Primary signal: which tab is active in this window after the user selects a tab.
tabsOnActivated.addListener(({ tabId }) => {
  rebuildPageCommandMenuTab(tabId);
});

// Switching focused window does not always fire tabs.onActivated; align menu with that window’s tab.
if (browserWindows?.onFocusChanged) {
  browserWindows.onFocusChanged.addListener((windowId) => {
    if (windowId == null || windowId < 0) return;
    browser.tabs.query({ active: true, windowId }).then((tabs) => {
      const t = tabs[0];
      if (t?.id != null) rebuildPageCommandMenuTab(t.id);
    });
  });
}

// Create stable parent once; dynamic children are recreated by rebuildPageCommandMenuTab.
if (contextMenus && init) {
  init.then(() => {
    contextMenus.create({
      id: VM_PAGE_CMD_ROOT,
      title: i18n('extName'),
      contexts: ['page', 'frame'],
      visible: false,
    }, ignoreChromeErrors);
    getActiveTab().then((t) => {
      if (t?.id != null) rebuildPageCommandMenuTab(t.id);
    });
  });
}

/**
 * Handles context menu clicks for ids created by rebuildPageCommandMenuTab.
 * Security: encTabId must equal tab.id from the browser (prevents cross-tab id spoofing).
 *
 * @param {string|number} id
 * @param {chrome.tabs.Tab} tab
 * @returns {boolean} true if handled
 */
export function tryHandlePageMenuCommand(id, tab) {
  if (typeof id !== 'string' || !id.startsWith(CMD_PREFIX)) return false;
  const rest = id.slice(CMD_PREFIX.length);
  const m = /^(\d+):(\d+):([\s\S]+)$/.exec(rest);
  if (!m) return false;
  const [, encTabId, scriptId, encKey] = m;
  if (+encTabId !== tab.id) return false;
  const key = decodeURIComponent(encKey);
  const sid = `${scriptId}:${key}`;
  const frameId = routeTab[tab.id]?.[sid];
  // Synthetic event so injected Command handler runs like a context-menu activation from the popup.
  const evt = {
    type: 'mouseup',
    button: 2,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
  sendTabCmd(tab.id, 'Command', {
    id: +scriptId,
    key,
    evt,
  }, frameId == null ? undefined : { [kFrameId]: frameId });
  return true;
}
