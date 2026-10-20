import { tryBrowserListener } from '@/common/browser-listener';
import { addPublicCommands } from './init';
import sessionData, { flushSession, gmTabs, kGmTabs } from './session-data';

addPublicCommands({
  async GetTab({ id }, src) {
    if (__.MV3) await sessionData;
    const tabId = getTabId(id, src);
    return gmTabs[id]?.[tabId] || {};
  },
  async SaveTab({ id, tab }, src) {
    if (__.MV3) await sessionData;
    const tabId = getTabId(id, src);
    if (!isObject(tab)) throw new SafeError('Tab information must be an object.');
    (gmTabs[id] ||= {})[tabId] = tab;
    if (__.MV3) flushSession(kGmTabs, gmTabs);
  },
  async GetTabs({ id }, src) {
    if (__.MV3) await sessionData;
    getTabId(id, src);
    return gmTabs[id] || {};
  },
});

tryBrowserListener(browser.tabs.onRemoved, 'addListener', removeTabState);
tryBrowserListener(browser.tabs.onReplaced, 'addListener',
  (addedId, removedId) => removeTabState(removedId));

async function removeTabState(tabId) {
  if (__.MV3) await sessionData;
  let changed;
  for (const id of Object.keys(gmTabs)) {
    const tabs = gmTabs[id];
    if (hasOwnProperty(tabs, tabId)) {
      delete tabs[tabId];
      if (!Object.keys(tabs).length) delete gmTabs[id];
      changed = true;
    }
  }
  if (changed && __.MV3) flushSession(kGmTabs, gmTabs);
}

function getTabId(id, src) {
  if (!Number.isInteger(id) || id <= 0) throw new SafeError('Invalid script id.');
  const tabId = src?.tab?.id;
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new SafeError('Tab state is only available in a browser tab.');
  }
  return tabId;
}
