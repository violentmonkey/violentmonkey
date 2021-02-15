import { getActiveTab, sendTabCmd } from '#/common';
import cache from './cache';
import { getData } from './db';
import { postInitialize } from './init';
import { commands } from './message';

export const popupTabs = {}; // { tabId: 1 }

postInitialize.push(() => {
  browser.runtime.onConnect.addListener(onPopupOpened);
  browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
    urls: [browser.runtime.getURL(browser.runtime.getManifest().browser_action.default_popup)],
    types: ['main_frame'],
  });
});

function onPopupOpened(port) {
  const tabId = +port.name;
  popupTabs[tabId] = 1;
  sendTabCmd(tabId, 'PopupShown', true);
  port.onDisconnect.addListener(onPopupClosed);
  delete commands.SetPopup;
}

function onPopupClosed({ name }) {
  delete popupTabs[name];
  sendTabCmd(+name, 'PopupShown', false);
}

async function prefetchSetPopup() {
  const tabId = (await getActiveTab()).id;
  sendTabCmd(tabId, 'PopupShown', true);
  commands.SetPopup = async (data, src) => {
    Object.assign(data, await getData(data.ids));
    cache.put('SetPopup', Object.assign({ [src.frameId]: [data, src] }, cache.get('SetPopup')));
  };
}
