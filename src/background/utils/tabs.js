import { noop } from 'src/common';

const openers = {};

browser.tabs.onRemoved.addListener(id => {
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
  const { url, active } = data;
  const srcTab = src.tab || {};
  return browser.tabs.create({
    url,
    active,
    windowId: srcTab.windowId,
    index: srcTab.index + 1,
  })
  .then(tab => {
    const { id } = tab;
    openers[id] = srcTab.id;
    return { id };
  });
}

export function tabClose(data, src) {
  const tabId = (data && data.id) || (src.tab && src.tab.id);
  if (tabId) browser.tabs.remove(tabId);
}
