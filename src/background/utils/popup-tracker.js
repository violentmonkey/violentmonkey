import { getActiveTab, sendTabCmd } from '@/common';
import cache from './cache';
import { getData } from './db';
import { badges, BROWSER_ACTION, getFailureReason } from './icon';
import { postInitialize } from './init';
import { addPublicCommands, commands } from './message';
import { INJECT } from './preinject';

/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

addPublicCommands({
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = await commands.GetTabDomain(url);
    const cachedSetPopup = cache.pop(getCacheKey(tabId));
    const badgeData = badges[tabId] || {};
    let failure = getFailureReason(url, badgeData);
    if (!failure[0] && !cachedSetPopup && !await isInjectable(tabId, badgeData)) {
      failure = getFailureReason('');
    }
    data.tab = tab;
    return [cachedSetPopup, data, failure];
  },
  async SetPopup(data, src) {
    const tabId = src.tab.id;
    const key = getCacheKey(tabId);
    if (popupTabs[tabId]) return;
    Object.assign(data, await getData({ [IDS]: Object.keys(data[IDS]) }));
    (cache.get(key) || cache.put(key, {}))[src.frameId] = [data, src];
  }
});

postInitialize.push(() => {
  browser.runtime.onConnect.addListener(onPopupOpened);
  browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
    urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
    types: ['main_frame'],
  });
});

async function isInjectable(tabId, badgeData) {
  return badgeData[INJECT]
    && await sendTabCmd(tabId, VIOLENTMONKEY, null, { frameId: 0 })
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
  if (badges[tabId]?.[INJECT]) {
    sendTabCmd(tabId, 'PopupShown', data);
  }
}
