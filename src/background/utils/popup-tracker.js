import { getActiveTab, i18n, sendTabCmd } from '@/common';
import cache from './cache';
import { getData, getScriptsByURL } from './db';
import { badges, getFailureReason } from './icon';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { getOption } from './options';
import { executeScriptInTab, getUserScriptsHealth } from './tabs';

/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

addOwnCommands({
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = commands.GetTabDomain(url);
    const badgeData = badges[tabId] || {};
    const isAppliedNow = getOption(IS_APPLIED);
    let failure = url ? getFailureReason(url, badgeData, '') : [''];
    // Tab state may still carry a stale "off" marker from an earlier disabled period.
    // If global apply is currently enabled, force a fresh injectability probe below.
    if (failure[1] === IS_APPLIED && badgeData[INJECT] === 'off' && isAppliedNow) {
      badgeData[INJECT] = null;
      failure = [''];
    }
    // FF injects content scripts after update/install/reload
    let reset = !IS_FIREFOX && !failure[0] && badgeData[INJECT] === undefined;
    let cachedSetPopup = cache.pop(getCacheKey(tabId));
    if (reset && (cachedSetPopup ? !cachedSetPopup[0] : cachedSetPopup = {})) {
      cachedSetPopup[0] = await augmentSetPopup(
        { [IDS]: {}, menus: {} },
        { tab, url, [kFrameId]: 0, [kTop]: 1 },
      );
    }
    // MV3: webRequest.onBeforeRequest doesn't fire for chrome-extension:// popup URLs,
    // so isPopupShown is never set early → sendSetPopup is a no-op when scripts finish →
    // SetPopup cache is never populated. When INJECT===true (scripts confirmed ran) but
    // no cache exists, do a fresh augmentation so the popup shows eligible scripts.
    if (!IS_FIREFOX && !failure[0] && !cachedSetPopup && badgeData[INJECT] === true) {
      cachedSetPopup = {};
      cachedSetPopup[0] = await augmentSetPopup(
        { [IDS]: {}, menus: {} },
        { tab, url, [kFrameId]: 0, [kTop]: 1 },
      );
    }
    if (!failure[0] && badgeData[INJECT] == null) {
      if (!await isInjectable(tabId, badgeData)) {
        failure = getFailureReason('');
        if (extensionManifest.manifest_version === 3) {
          const health = await getUserScriptsHealth?.();
          if (health?.state === 'disabled' && health.message) {
            failure = [health.message, INJECT_INTO];
          }
        }
      } else if (reset && (reset = cachedSetPopup[0][0])[SCRIPTS].length) {
        /* We also show this after the background script is reloaded inside devtools, which keeps
           the content script connected, but breaks GM_xxxValue, GM_xhr, and so on. */
        failure = [i18n('failureReasonRestarted'), IS_APPLIED];
        reset[INJECT_INTO] = 'off';
      }
    }
    if (process.env.DEBUG && failure[1] === INJECT_INTO) {
      const userScripts = chrome.userScripts || browser.userScripts;
      console.warn('MV3 noninjectable popup diagnosis', {
        manifestVersion: extensionManifest.manifest_version,
        tabId,
        url: tab.url || '',
        pendingUrl: tab.pendingUrl || '',
        badgeInjectState: badgeData[INJECT],
        userscriptsApi: {
          execute: !!userScripts?.execute,
          register: !!userScripts?.register,
        },
        failure,
      });
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
      return; // allowing the visible popup's onMessage to handle this message
    }
    augmentSetPopup(data, src, key);
  }
});

browser.runtime.onConnect.addListener(onPopupOpened);
try {
  browser.webRequest.onBeforeRequest.addListener(prefetchSetPopup, {
    urls: [chrome.runtime.getURL(extensionManifest[BROWSER_ACTION].default_popup)],
    types: ['main_frame'],
  });
} catch (e) {
  if (process.env.DEBUG) {
    console.warn('Popup prefetch hook is unavailable in this runtime.', e);
  }
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

async function isInjectable(tabId, badgeData) {
  const isMv3 = extensionManifest.manifest_version === 3;
  const probe = badgeData[INJECT]
    && await sendTabCmd(tabId, VIOLENTMONKEY, null, { [kFrameId]: 0 })
    || (
      await executeScriptInTab(tabId, {
        code: '1',
        [RUN_AT]: 'document_start',
        tryUserScripts: isMv3,
        allowRegisterFallback: false,
        allowLegacyCodeFallback: false,
      })
      .catch(() => [])
    )[0];
  if (probe != null) return probe;
  if (isMv3) {
    const userScripts = chrome.userScripts || browser.userScripts;
    if (userScripts?.execute || userScripts?.register) return true;
  }
  return false;
}

function onPopupOpened(port) {
  const [cmd, cached, tabId] = port.name.split(':');
  if (cmd !== 'Popup') return;
  if (!cached) notifyTab(+tabId, true);
  popupTabs[tabId] = port;
  port.onDisconnect.addListener(() => {
    delete popupTabs[tabId];
    notifyTab(+tabId, false);
  });
}

function prefetchSetPopup() {
  getActiveTab().then(t => t && notifyTab(t.id, true));
}

function notifyTab(tabId, data) {
  if (badges[tabId]) {
    sendTabCmd(tabId, 'PopupShown', data);
  }
}
