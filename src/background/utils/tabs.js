import { noop, getActiveTab } from '#/common';
import ua from '#/common/ua';

// Firefox Android does not support `openerTabId` field, it fails if this field is passed
ua.ready.then(() => {
  Object.defineProperties(ua, {
    openerTabIdSupported: {
      value: ua.isChrome || ua.isFirefox >= 57 && ua.os !== 'android',
    },
  });
});

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

export async function tabOpen({
  url,
  active,
  insert = true,
}, src) {
  // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
  const {
    id: openerTabId,
    index,
    windowId,
  } = src.tab || await getActiveTab() || {};
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
}

export function tabClose(data, src) {
  const tabId = (data && data.id) || (src.tab && src.tab.id);
  if (tabId) browser.tabs.remove(tabId);
}
