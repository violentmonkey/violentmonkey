import { noop } from '#/common';
import { isFirefox, isAndroid } from '#/common/ua';

const openers = {};

browser.tabs.onRemoved.addListener((id) => {
  const openerId = openers[id];
  if (openerId) {
    browser.tabs.sendMessage(openerId, {
      cmd: 'TabClosed',
      data: id,
    })
    .catch(noop);
    delete openers[id];
  }
});

export function tabOpen(data, src) {
  const {
    url,
    active,
    insert = true,
  } = data;
  const srcTab = src.tab || {};
  const options = {
    url,
    active,
    windowId: srcTab.windowId,
  };
  if (insert) {
    options.index = srcTab.index + 1;
  }
  // Firefox Android does not support `openerTabId` field, it fails if this field is passed
  if (!isFirefox || !isAndroid) {
    // XXX openerTabId seems buggy on Chrome
    // It seems to do nothing even set successfully with `browser.tabs.update`.
    // Reference: http://crbug.com/967150
    options.openerTabId = srcTab.id;
  }
  return browser.tabs.create(options)
  .then((tab) => {
    const { id } = tab;
    openers[id] = srcTab.id;
    return { id };
  });
}

export function tabClose(data, src) {
  const tabId = (data && data.id) || (src.tab && src.tab.id);
  if (tabId) browser.tabs.remove(tabId);
}
