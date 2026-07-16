import { getActiveTab, sendTabCmd } from '@/common';
import { CACHE_KEYS, PROMISE } from '@/common/consts';
import { deepCopy } from '@/common/object';
import { getScriptsByURL } from './db';
import { setBadge } from './icon';
import { addOwnCommands, addPublicCommands } from './init';
import { clearNotifications } from './notifications';
import { addMenuConfig, setMenus } from './page-menu-commands';
import { popupTabs } from './popup-tracker';
import {
  cache, contentScriptsAPI, CSAPI_REG, getKey, injectContentRealm, isApplied, propsToClear,
  skippedTabs, unregisterScript,
} from './preinject-core';
import { prepare, prepareScripts, triageRealms } from './preinject-prepare';
import { clearRequestsByTabId, reifyRequests } from './requests';
import { updateVisitedTime } from './script';
import {
  onStorageChanged, S_CACHE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE, S_VALUE_PRE,
} from './storage';
import { getFrameDocId, getFrameDocIdAsObj } from './tabs';
import { addValueOpener, clearValueOpener, reifyValueOpener } from './values';

addOwnCommands({
  [SKIP_SCRIPTS]: reloadAndSkipScripts,
});

addPublicCommands({
  /** @return {Promise<VMInjection>} */
  async GetInjected({ url, [FORCE_CONTENT]: forceContent, done }, src) {
    const { tab, [kFrameId]: frameId, [kTop]: isTop } = src;
    const frameDoc = getFrameDocId(isTop, src[kDocumentId], frameId);
    const tabId = tab.id;
    if (!url) url = src.url || tab.url;
    clearFrameData(tabId, frameDoc);
    let skip = skippedTabs[tabId];
    if (skip > 0) { // first time loading the tab after skipScripts was invoked
      if (isTop) skippedTabs[tabId] = -1; // keeping a phantom for future iframes in this page
      if (popupTabs[tabId]) sendPopupShown(tabId, frameDoc);
      return { [INJECT_INTO]: SKIP_SCRIPTS };
    }
    if (skip) delete skippedTabs[tabId]; // deleting the phantom as we're in a new page
    const bagKey = getKey(url, isTop);
    const bagP = cache.get(bagKey) || prepare(bagKey, url, isTop);
    const bag = bagP[INJECT] ? bagP : await bagP[PROMISE];
    /** @type {VMInjection} */
    const inject = bag[INJECT];
    const scripts = inject[SCRIPTS];
    if (scripts) {
      triageRealms(scripts, bag[FORCE_CONTENT] || forceContent, tabId, frameId, bag);
      addValueOpener(scripts, tabId, frameDoc);
      addMenuConfig(inject);
      if (isTop < 2/* skip prerendered pages*/ && scripts.length) {
        updateVisitedTime(scripts);
      }
      inject.info.gmi = { isIncognito: tab.incognito };
    }
    if (popupTabs[tabId]) {
      sendPopupShown(tabId, frameDoc);
    }
    return isApplied
      ? !done && inject
      : { [INJECT_INTO]: 'off', ...inject };
  },
  async InjectionFeedback({
    [FORCE_CONTENT]: forceContent,
    [CONTENT]: items,
    [MORE]: moreKey,
    url,
  }, src) {
    if (!isApplied) return; // the user disabled injection right after page started loading
    const { tab, [kFrameId]: frameId } = src;
    const isTop = src[kTop];
    const tabId = tab.id;
    injectContentRealm(items, tabId, frameId);
    if (!moreKey) return;
    if (!url) url = src.url || tab.url;
    const env = cache.get(moreKey)
      || cache.put(moreKey, getScriptsByURL(url, isTop))
      || { [SCRIPTS]: [] }; // scripts got removed or the url got blacklisted after GetInjected
    const envCache = (env[PROMISE] ? await env[PROMISE] : env)[S_CACHE];
    const scripts = prepareScripts(env);
    triageRealms(scripts, forceContent, tabId, frameId);
    addValueOpener(scripts, tabId, getFrameDocId(isTop, src[kDocumentId], frameId));
    if (isTop < 2/* skip prerendered pages*/ && scripts.length) {
      updateVisitedTime(scripts);
    }
    return {
      [SCRIPTS]: scripts,
      [S_CACHE]: envCache,
    };
  },
  Run({ [IDS]: ids, reset }, src) {
    const {
      [kDocumentId]: docId,
      [kTop]: isTop,
      tab: { id: tabId },
    } = src;
    const hasIds = +ids?.[0];
    setBadge(ids, reset, src);
    if (isTop === 3) {
      if (hasIds) {
        reifyValueOpener(ids, docId);
        updateVisitedTime(ids, true);
      }
      reifyRequests(tabId, docId);
      clearNotifications(tabId);
    }
    if (reset === 'bfcache' && hasIds) {
      addValueOpener(ids, tabId, getFrameDocId(isTop, docId, src[kFrameId]));
    }
    if (reset) {
      setMenus({}, src, reset);
    }
  },
});

onStorageChanged((keys, data) => {
  const toClear = [];
  for (const key of keys) {
    const i = key.indexOf(':') + 1;
    const prefix = key.slice(0, i);
    const id = key.slice(i);
    /* TODO: only delete the script's entry if no impactful @key is changed in metablock?
       Might be beneficial for local file tracking. */
    if (propsToClear[prefix] === true) {
      cache.destroy();
      return;
    }
    let script, values;
    // Patching cached script's values
    if (prefix === S_VALUE_PRE) {
      values = data?.[key];
      if ((script = cache.get(S_SCRIPT_PRE + id))) {
        script[VALUES] = values = deepCopy(values) || script[VALUES] && {};
        // {} enables tracking in addValueOpener
      }
    }
    // Removing values/require/resource in injection bags
    if (prefix) {
      toClear.push([prefix, id, values]);
    }
  }
  if (toClear.length) cache.some(removeStaleCacheEntry, toClear);
});

export async function reloadAndSkipScripts(tab) {
  if (!tab) tab = await getActiveTab();
  const tabId = tab.id;
  const bag = cache.get(getKey(tab.url, true));
  const reg = (__.MV3 ? chrome.userScripts : contentScriptsAPI) && bag && unregisterScript(bag);
  skippedTabs[tabId] = 1;
  if (reg) await reg;
  clearFrameData(tabId);
  await browser.tabs.reload(tabId);
}

/** @this {string[][]} changed storage keys, already split as [prefix,id] */
function removeStaleCacheEntry(val, key) {
  if (!val[CACHE_KEYS]) return;
  for (const [prefix, id, newData] of this) {
    const prop = propsToClear[prefix];
    if (val[prop]?.includes(+id || id)) {
      if (prefix === S_REQUIRE_PRE) {
        val.depsMap[id].forEach(scriptId => cache.del(S_SCRIPT_PRE + scriptId));
      } else if (prefix === S_VALUE_PRE) {
        if (val[S_VALUE]) val[S_VALUE][id] = newData; // envDelayed
        setBaggedScriptValues(val, +id, newData);
        if (!val[CSAPI_REG]) continue;
      }
      cache.del(key); // TODO: try to patch the cache in-place?
    }
  }
}

function setBaggedScriptValues(bag, id, val) {
  for (const /** @type {VMInjection.Script} */scr of (bag[INJECT] || bag)[SCRIPTS]) {
    if (scr.id === id) {
      scr[VALUES] = val || scr[VALUES] && {};
      // {} enables tracking in addValueOpener
      return true;
    }
  }
}

function clearFrameData(tabId, frameId, tabRemoved) {
  clearRequestsByTabId(tabId, frameId);
  clearValueOpener(tabId, frameId);
  clearNotifications(tabId, frameId, tabRemoved);
}

function sendPopupShown(tabId, frameDoc) {
  setTimeout(sendTabCmd, 0, tabId, 'PopupShown', true, getFrameDocIdAsObj(frameDoc));
}
