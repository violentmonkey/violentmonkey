import { getActiveTab, sendTabCmd } from '@/common';
import cache from './cache';
import { getData } from './db';
import { postInitialize } from './init';
import { addPublicCommands } from './message';

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
    urls: [chrome.runtime.getURL(extensionManifest.browser_action.default_popup)],
    types: ['main_frame'],
  });
});

function onPopupOpened(port) {
  const tabId = +port.name;
  if (!tabId) return;
  popupTabs[tabId] = 1;
  sendTabCmd(tabId, 'PopupShown', true);
  port.onDisconnect.addListener(onPopupClosed);
}

function onPopupClosed({ name }) {
  delete popupTabs[name];
  sendTabCmd(+name, 'PopupShown', false);
}

async function prefetchSetPopup() {
  const tabId = (await getActiveTab()).id;
  sendTabCmd(tabId, 'PopupShown', true);
}
