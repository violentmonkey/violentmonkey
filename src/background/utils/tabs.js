import { getActiveTab, sendTabCmd } from '#/common';
import ua from '#/common/ua';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<{ id: number }>} */
  async TabOpen({ url, active, insert = true }, src) {
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const { id: openerTabId, index, windowId } = src?.tab || await getActiveTab() || {};
    const tab = await browser.tabs.create({
      url,
      active,
      windowId,
      ...insert && { index: index + 1 },
      // XXX openerTabId seems buggy on Chrome, https://crbug.com/967150
      // It seems to do nothing even set successfully with `browser.tabs.update`.
      ...ua.openerTabIdSupported && { openerTabId },
    });
    const { id } = tab;
    openers[id] = openerTabId;
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
