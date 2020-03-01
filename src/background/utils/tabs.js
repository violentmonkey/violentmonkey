import { getActiveTab, sendTabCmd, getFullUrl } from '#/common';
import ua from '#/common/ua';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<{ id: number }>} */
  async TabOpen({
    url, active, container, insert = true, pinned,
  }, src = {}) {
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const srcTab = src.tab || await getActiveTab() || {};
    // src.url may be absent when invoked directly as commands.TabOpen
    const isInternal = !src.url || src.url.startsWith(window.location.protocol);
    const storeId = srcTab.cookieStoreId;
    const { id } = await browser.tabs.create({
      active: active !== false,
      pinned: !!pinned,
      url: isInternal || url.startsWith('blob:') ? url : getFullUrl(url, src.url),
      windowId: srcTab.windowId,
      ...storeId && { cookieStoreId: getContainerId(isInternal ? 0 : container) || storeId },
      ...insert && { index: srcTab.index + 1 },
      // XXX openerTabId seems buggy on Chrome, https://crbug.com/967150
      // It seems to do nothing even set successfully with `browser.tabs.update`.
      ...ua.openerTabIdSupported && { openerTabId: srcTab.id },
    });
    openers[id] = srcTab.id;
    return { id };
  },
  /** @return {void} */
  TabClose({ id } = {}, src) {
    const tabId = id || src?.tab?.id;
    if (tabId >= 0) browser.tabs.remove(tabId);
  },
});

// Firefox Android does not support `openerTabId` field, it fails if this field is passed
ua.ready.then(() => {
  Object.defineProperties(ua, {
    openerTabIdSupported: {
      value: ua.isChrome || ua.isFirefox >= 57 && ua.os !== 'android',
    },
  });
});

browser.tabs.onRemoved.addListener((id) => {
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'TabClosed', id);
    delete openers[id];
  }
});

function getContainerId(index) {
  return index === 0 && 'firefox-default'
         || index > 0 && `firefox-container-${index}`;
}
