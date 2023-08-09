import { getActiveTab, sendTabCmd } from '@/common';
import cache from './cache';
import { getData } from './db';
import { badges, BROWSER_ACTION } from './icon';
import { postInitialize } from './init';
import { addPublicCommands } from './message';
import { INJECT } from './preinject';

export const popupTabs = {}; // { tabId: 1 }

addPublicCommands({
  async SetPopup(data, src) {
    if (popupTabs[src.tab.id]) return;
    Object.assign(data, await getData({ [IDS]: Object.keys(data[IDS]) }));
    cache.put('SetPopup', Object.assign({ [src.frameId]: [data, src] }, cache.get('SetPopup')));
  },
});

postInitialize.push(() => {
  browser.runtime.onConnect.addListener(onPopupOpened);
  browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
    urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
    types: ['main_frame'],
  });
});

function onPopupOpened(port) {
  const tabId = +port.name;
  if (!tabId) return;
  popupTabs[tabId] = 1;
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
