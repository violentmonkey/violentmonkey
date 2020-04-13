import { getActiveTab, sendTabCmd, getFullUrl } from '#/common';
import ua from '#/common/ua';
import { extensionRoot } from './init';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<{ id: number }>} */
  async TabOpen({
    url,
    active = true,
    container,
    insert = true,
    pinned,
  }, src = {}) {
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const srcTab = src.tab || await getActiveTab() || {};
    // src.url may be absent when invoked directly as commands.TabOpen
    const srcUrl = src.url;
    const isInternal = !srcUrl || srcUrl.startsWith(extensionRoot);
    // only incognito storeId may be specified when opening in an incognito window
    const { incognito, windowId } = srcTab;
    let storeId = srcTab.cookieStoreId;
    if (storeId && !incognito) {
      storeId = getContainerId(isInternal ? 0 : container) || storeId;
    }
    if (!url.startsWith('blob:')) {
      // URL needs to be expanded to check the protocol for 'chrome' below
      if (!isInternal) url = getFullUrl(url, srcUrl);
      else if (!/^\w+:/.test(url)) url = browser.runtime.getURL(url);
    }
    const { id, windowId: newWindowId } = await browser.tabs.create({
      url,
      // normalizing as boolean because the API requires strict types
      active: !!active,
      pinned: !!pinned,
      ...storeId && { cookieStoreId: storeId },
      // Chrome can't open chrome-xxx: URLs in incognito windows
      ...!incognito || ua.isFirefox || !/^(chrome[-\w]*):/.test(url) && {
        windowId,
        ...insert && { index: srcTab.index + 1 },
        ...ua.openerTabIdSupported && { openerTabId: srcTab.id },
      },
    });
    if (active && newWindowId !== windowId) {
      await browser.windows.update(newWindowId, { focused: true });
    }
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
// XXX openerTabId seems buggy on Chrome, https://crbug.com/967150
// It seems to do nothing even set successfully with `browser.tabs.update`.
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
