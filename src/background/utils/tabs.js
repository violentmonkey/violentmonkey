import { getActiveTab, noop, sendTabCmd, getFullUrl } from '#/common';
import ua from '#/common/ua';
import { extensionRoot } from './init';
import { commands } from './message';
import { getOption } from './options';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<{ id: number }>} */
  async TabOpen({
    url,
    active = true,
    container,
    insert = true,
    maybeInWindow = false,
    pinned,
  }, src = {}) {
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const srcTab = src.tab || await getActiveTab() || {};
    // src.url may be absent when invoked directly as commands.TabOpen
    const srcUrl = src.url;
    const isInternal = !srcUrl || srcUrl.startsWith(extensionRoot);
    // only incognito storeId may be specified when opening in an incognito window
    const { incognito, windowId } = srcTab;
    // Chrome can't open chrome-xxx: URLs in incognito windows
    const canOpenIncognito = !incognito || ua.isFirefox || !/^(chrome[-\w]*):/.test(url);
    let storeId = srcTab.cookieStoreId;
    if (storeId && !incognito) {
      storeId = getContainerId(isInternal ? 0 : container) || storeId;
    }
    if (storeId) storeId = { cookieStoreId: storeId };
    if (!url.startsWith('blob:')) {
      // URL needs to be expanded to check the protocol for 'chrome' below
      if (!isInternal) url = getFullUrl(url, srcUrl);
      else if (!/^\w+:/.test(url)) url = browser.runtime.getURL(url);
    }
    let newTab;
    if (maybeInWindow && browser.windows && getOption('editorWindow')) {
      const wndOpts = {
        url,
        incognito: canOpenIncognito && incognito,
        ...getOption('editorWindowSimple') && { type: 'popup' },
        ...ua.isChrome && { focused: !!active }, // FF doesn't support this
        ...storeId,
      };
      const pos = getOption('editorWindowPos');
      const hasPos = pos && 'top' in pos;
      const wnd = await browser.windows.create({ ...wndOpts, ...pos }).catch(hasPos && noop)
        || hasPos && await browser.windows.create(wndOpts);
      newTab = wnd.tabs[0];
    }
    const { id, windowId: newWindowId } = newTab || await browser.tabs.create({
      url,
      // normalizing as boolean because the API requires strict types
      active: !!active,
      pinned: !!pinned,
      ...storeId,
      ...canOpenIncognito && {
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
