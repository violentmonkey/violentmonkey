import { getActiveTab, sendTabCmd } from '@/common';
import cache from './cache';
import { getData, getScriptsByURL } from './db';
import { badges, getFailureReason } from './icon';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { probeTabInjection } from './tabs';

/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

addOwnCommands({
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = commands.GetTabDomain(url);
    const badgeData = badges[tabId] || {};
    let failure = getFailureReason(url, badgeData, '');
    // In MV3 Chrome the service worker can unload at any time, so lack of badge state
    // does not mean the extension restarted. We still hydrate popup data on demand.
    const needsHydration = !IS_FIREFOX && !failure[0] && badgeData[INJECT] === undefined;
    let cachedSetPopup = cache.pop(getCacheKey(tabId));
    if (needsHydration && (cachedSetPopup ? !cachedSetPopup[0] : cachedSetPopup = {})) {
      cachedSetPopup[0] = await augmentSetPopup(
        { [IDS]: {}, menus: {} },
        { tab, url, [kFrameId]: 0, [kTop]: 1 },
      );
    }
    if (!failure[0] && badgeData[INJECT] == null) {
      if (!await isInjectable(tabId, badgeData)) {
        failure = getFailureReason('');
      }
    }
    data.tab = tab;
    return [cachedSetPopup, data, failure];
  },
});

addPublicCommands({
  /** Must be synchronous for proper handling of `return;` inside */
  SetPopup(data, src) {
    const tabId = src.tab.id;
    const key = getCacheKey(tabId);
    if (popupTabs[tabId]) {
      popupTabs[tabId].postMessage({
        cmd: 'SetPopup',
        data,
        src: {
          tab: src.tab,
          url: src.url,
          [kFrameId]: src[kFrameId],
        },
      });
      return;
    }
    augmentSetPopup(data, src, key);
  }
});

browser.runtime.onConnect.addListener(onPopupOpened);

// Manifest V3 doesn't support webRequest - skip prefetch optimization
if (browser.webRequest?.onBeforeRequest) {
  browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
    urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
    types: ['main_frame'],
  });
}

async function augmentSetPopup(data, src, key) {
  data[MORE] = true;
  const ids = data[IDS];
  const moreIds = getScriptsByURL(src.url, src[kTop], null, ids);
  Object.assign(ids, moreIds);
  Object.assign(data, await getData({ [IDS]: Object.keys(ids) }));
  data = [data, src];
  if (!key) return data;
  (cache.get(key) || cache.put(key, {}))[src[kFrameId]] = data;
}

export function setPopupError(tabId, frameId, message, url = '') {
  const key = getCacheKey(tabId);
  const entry = cache.get(key) || cache.put(key, {});
  const current = entry[frameId];
  const data = current?.[0] || {
    [IDS]: {},
    menus: {},
    [MORE]: true,
  };
  const src = current?.[1] || {
    tab: { id: tabId },
    url,
    [kFrameId]: frameId,
  };
  data.errors = data.errors && data.errors !== message
    ? `${data.errors}\n${message}`
    : message;
  entry[frameId] = [data, src];
  if (popupTabs[tabId]) {
    popupTabs[tabId].postMessage({
      cmd: 'SetPopup',
      data,
      src: {
        tab: src.tab,
        url: src.url,
        [kFrameId]: src[kFrameId],
      },
    });
  }
}

async function isInjectable(tabId, badgeData) {
  // Try sendTabCmd first
  if (badgeData[INJECT] && await sendTabCmd(tabId, VIOLENTMONKEY, null, { [kFrameId]: 0 })) {
    return true;
  }
  return probeTabInjection(tabId);
}

function onPopupOpened(port) {
  const [cmd, cached, tabId] = port.name.split(':');
  if (cmd !== 'Popup') return;
  popupTabs[tabId] = port;
  if (!cached) notifyTab(+tabId, true);
  port.onDisconnect.addListener(() => {
    delete popupTabs[tabId];
    notifyTab(+tabId, false);
  });
}

function prefetchSetPopup() {
  getActiveTab().then(t => t && notifyTab(t.id, true));
}

function notifyTab(tabId, data) {
  sendTabCmd(tabId, 'PopupShown', data);
}
