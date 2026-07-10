import { executeScript, extensionDetailsUrl, registerInjector } from '@/common/browser-scripts-api';
import { getActiveTab, i18n, noop, sendTabCmd } from '@/common';
import { kMainFrame } from '@/common/consts';
import cache from './cache';
import { getData, getScriptsByURL } from './db';
import { getFailureReason } from './icon';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { setMenus } from './page-menu-commands';
import { badges } from './session-data';

/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

export async function initPopup() {
  const tab = await getActiveTab() || {};
  const { url = '', id: tabId } = tab;
  const data = commands.GetTabDomain(url);
  const badgeData = badges[tabId] || {};
  let failure = getFailureReason(url, badgeData, '');
  // FF injects content scripts after update/install/reload
  let reset = !IS_FIREFOX && !failure[0] && badgeData[INJECT] === undefined;
  let cachedSetPopup = cache.pop(getCacheKey(tabId));
  if (reset && (cachedSetPopup ? !cachedSetPopup[0] : cachedSetPopup = {})) {
    cachedSetPopup[0] = await augmentSetPopup(
      { [IDS]: {}, menus: {} },
      { tab, url, [kFrameId]: 0, [kTop]: 1 },
    );
  }
  if (!failure[0] && badgeData[INJECT] == null) {
    const state = await isInjectable(tabId, badgeData).catch(err => err);
    if (state !== true) {
      failure = __.MV3 && state
        ? [state.stack || state, 'infoUrl', extensionDetailsUrl]
        : getFailureReason('');
    } else if (reset && (reset = cachedSetPopup[0][0])[SCRIPTS].length) {
      /* We also show this after the background script is reloaded inside devtools, which keeps
         the content script connected, but breaks GM_xxxValue, GM_xhr, and so on. */
      failure = [i18n('failureReasonRestarted'), IS_APPLIED];
      reset[INJECT_INTO] = 'off';
    }
  }
  data.tab = tab;
  return [cachedSetPopup, data, failure];
}

addOwnCommands({
  InitPopup: initPopup,
});

addPublicCommands({
  /** Must be synchronous for proper handling of `return;` inside */
  SetPopup(data, src) {
    const tabId = src.tab.id;
    const key = getCacheKey(tabId);
    setMenus(data.menus, src);
    if (popupTabs[tabId]) {
      return; // allowing the visible popup's onMessage to handle this message
    }
    augmentSetPopup(data, src, key);
  }
});

browser.runtime.onConnect.addListener(onPopupOpened);
browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
  urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
  types: [kMainFrame],
});

async function augmentSetPopup(data, src, key) {
  data[MORE] = true;
  const ids = data[IDS];
  const moreIds = getScriptsByURL(src.url, src[kTop], null, ids);
  Object.assign(ids, moreIds);
  Object.assign(data, await getData({ [IDS]: Object.keys(ids) }));
  data = [data, src];
  if (!key) return data;
  (cache.get(key) || cache.put(key, {}))[src[kFrameId]] = data;
}

/** @return {Promise<void|true|Error|string>} */
async function isInjectable(tabId, badgeData) {
  return badgeData[INJECT] && await sendTabCmd(tabId, VIOLENTMONKEY, null, { [kFrameId]: 0 })
    || __.MV3 && await registerInjector()
    || executeScript(tabId, 'true', 'document_start').catch(noop);
}

function onPopupOpened(port) {
  const [cmd, cached, tabId] = port.name.split(':');
  if (cmd !== 'Popup') return;
  if (!cached) notifyTab(+tabId, true);
  popupTabs[tabId] = port;
  port.onDisconnect.addListener(() => {
    delete popupTabs[tabId];
    notifyTab(+tabId, false);
  });
}

function prefetchSetPopup() {
  getActiveTab().then(t => t && notifyTab(t.id, true));
}

function notifyTab(tabId, data) {
  if (badges[tabId]) {
    sendTabCmd(tabId, 'PopupShown', data);
  }
}
