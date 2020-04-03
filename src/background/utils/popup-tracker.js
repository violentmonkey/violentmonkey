import { sendTabCmd } from '#/common';
import { postInitialize } from './init';

export const popupTabs = {}; // { tabId: 1 }

postInitialize.push(() => {
  browser.runtime.onConnect.addListener(onPopupOpened);
});

function onPopupOpened(port) {
  const tabId = +port.name;
  popupTabs[tabId] = 1;
  sendTabCmd(tabId, 'PopupShown', true);
  port.onDisconnect.addListener(onPopupClosed);
}

function onPopupClosed({ name }) {
  delete popupTabs[name];
  sendTabCmd(+name, 'PopupShown', false);
}
