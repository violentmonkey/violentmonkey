import { getActiveTab, sendTabCmd } from '@/common';
import cache from './cache';
import { getData, getScriptsByURL } from './db';
import { badges, getFailureReason } from './icon';
import { addOwnCommands, addPublicCommands, commands } from './init';

/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

addOwnCommands({
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = commands.GetTabDomain(url);
    const cachedSetPopup = cache.pop(getCacheKey(tabId));
    const badgeData = badges[tabId] || {};
    let failure = getFailureReason(url, badgeData);
    if (!failure[0] && !cachedSetPopup && !await isInjectable(tabId, badgeData)) {
      failure = getFailureReason('');
    }
    data.tab = tab;
    data[IS_APPLIED] = badgeData[INJECT] !== 'off'; // will be used by reloadHint in popup
    return [cachedSetPopup, data, failure];
  },
});

addPublicCommands({
  /** Must be synchronous for proper handling of `return;` inside */
  SetPopup(data, src) {
    const tabId = src.tab.id;
    const key = getCacheKey(tabId);
    if (popupTabs[tabId]) {
      return; // allowing the visible popup's onMessage to handle this message
    }
    data[MORE] = true;
    const ids = data[IDS];
    const moreIds = getScriptsByURL(src.url, src[kTop], null, ids);
    Object.assign(ids, moreIds);
    getData({ [IDS]: Object.keys(ids) }).then(res => {
      Object.assign(data, res);
      (cache.get(key) || cache.put(key, {}))[src[kFrameId]] = [data, src];
    });
  }
});

browser.runtime.onConnect.addListener(onPopupOpened);
browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
  urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
  types: ['main_frame'],
});

async function isInjectable(tabId, badgeData) {
  return badgeData[INJECT]
    && await sendTabCmd(tabId, VIOLENTMONKEY, null, { [kFrameId]: 0 })
    || (
      await browser.tabs.executeScript(tabId, { code: '1', [RUN_AT]: 'document_start' })
      .catch(() => [])
    )[0];
}

function onPopupOpened(port) {
  const tabId = +port.name;
  if (!tabId) return;
  popupTabs[tabId] = port;
  notifyTab(tabId, true);
  port.onDisconnect.addListener(onPopupClosed);
}

function onPopupClosed({ name }) {
  delete popupTabs[name];
  notifyTab(+name, false);
}

async function prefetchSetPopup() {
  notifyTab((await getActiveTab()).id, true);
}

function notifyTab(tabId, data) {
  if (badges[tabId]) {
    sendTabCmd(tabId, 'PopupShown', data);
  }
}
