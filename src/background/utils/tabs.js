import { browserWindows, getActiveTab, noop, sendTabCmd, getFullUrl } from '@/common';
import { getDomain } from '@/common/tld';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { getOption } from './options';
import { testScript } from './tester';
import { CHROME, FIREFOX } from './ua';

const openers = {};
const openerTabIdSupported = !IS_FIREFOX // supported in Chrome
  || !!(window.AbortSignal && browserWindows); // and FF57+ except mobile
const EDITOR_ROUTE = extensionOptionsPage + ROUTE_SCRIPTS + '/'; // followed by id
export const NEWTAB_URL_RE = re`/
^(
  about:(home|newtab) # Firefox
  | (chrome|edge):\/\/(
    newtab\/ # Chrome, Edge
    | startpageshared\/ # Opera
    | vivaldi-webui\/startpage # Vivaldi
  )
)$
/x`;
/** @returns {string|number} documentId for a pre-rendered top page, frameId otherwise */
export const getFrameDocId = (isTop, docId, frameId) => (
  isTop === 2 && docId || frameId
);
/** @param {VMMessageSender} src */
export const getFrameDocIdFromSrc = src => (
  src[kTop] === 2 && src[kDocumentId] || src[kFrameId]
);
export const getFrameDocIdAsObj = id => +id >= 0
  ? { [kFrameId]: +id }
  : { [kDocumentId]: id };
/**
 * @param {chrome.tabs.Tab} tab
 * @returns {string}
 */
export const getTabUrl = tab => (
  tab.pendingUrl || tab.url || ''
);
export const tabsOnUpdated = browser.tabs.onUpdated;
export const tabsOnRemoved = browser.tabs.onRemoved;
export let injectableRe = /^(https?|file|ftps?):/;
export let fileSchemeRequestable;
let cookieStorePrefix;

try {
  // onUpdated is filterable only in desktop FF 61+
  // but we use a try-catch anyway to detect this feature in nonstandard browsers
  tabsOnUpdated.addListener(noop, { properties: ['status'] });
  tabsOnUpdated.removeListener(noop);
} catch (e) {
  tabsOnUpdated.addListener = new Proxy(tabsOnUpdated.addListener, {
    apply: (fn, thisArg, args) => thisArg::fn(args[0]),
  });
}

addOwnCommands({
  GetTabDomain(url) {
    const host = url && new URL(url).hostname;
    return {
      host,
      domain: host && getDomain(host) || host,
    };
  },
  /**
   * @param {string} [pathId] - path or id: added to #scripts/ route in dashboard,
   * falsy: creates a new script for active tab's URL
   * @param {VMMessageSender} [src]
   */
  async OpenEditor(pathId, src) {
    return openDashboard(`${SCRIPTS}/${
      pathId || `_new/${src?.tab?.id || (await getActiveTab()).id}`
    }`, src);
  },
  OpenDashboard: openDashboard,
});

addPublicCommands({
  /** @return {Promise<{ id: number } | chrome.tabs.Tab>} new tab is returned for internal calls */
  async TabOpen({
    url,
    active = true,
    container,
    insert = true,
    pinned,
  }, src = {}) {
    const isRemoved = src._removed;
    // src.tab may be absent when invoked from popup (e.g. edit/create buttons)
    const srcTab = !isRemoved && src.tab
      || await getActiveTab(isRemoved && src.tab[kWindowId])
      || {};
    // src.url may be absent when invoked directly as commands.TabOpen
    const srcUrl = src.url;
    const isInternal = !srcUrl || srcUrl.startsWith(extensionRoot);
    // only incognito storeId may be specified when opening in an incognito window
    const { incognito, [kWindowId]: windowId } = srcTab;
    const canOpenIncognito = !incognito || IS_FIREFOX || !/^(chrome[-\w]*):/.test(url);
    const tabOpts = {
      // normalizing as boolean because the API requires strict types
      active: !!active,
      pinned: !!pinned,
    };
    let newTab;
    // Chrome can't open chrome-xxx: URLs in incognito windows
    // TODO: for src._removed maybe create a new window if cookieStoreId of active tab is different
    let storeId = srcTab.cookieStoreId;
    if (storeId && !incognito) {
      if (!cookieStorePrefix) {
        cookieStorePrefix = (await browser.cookies.getAllCookieStores())[0].id.split('-')[0];
      }
      if (isInternal || container === 0) {
        storeId = cookieStorePrefix + '-default';
      } else if (container > 0) {
        storeId = `${cookieStorePrefix}-container-${container}`;
      }
    }
    if (storeId) storeId = { cookieStoreId: storeId };
    // URL needs to be expanded for `canOpenIncognito` below
    if (!/^[-\w]+:/.test(url)) {
      url = isInternal
        ? browser.runtime.getURL(url)
        : getFullUrl(url, srcUrl);
    }
    if (isInternal
        && url.startsWith(EDITOR_ROUTE)
        && browserWindows
        && getOption('editorWindow')
        /* cookieStoreId in windows.create() is supported since FF64 https://bugzil.la/1393570
         * and a workaround is too convoluted to add it for such an ancient version */
        && (!storeId || FIREFOX >= 64)) {
      const wndOpts = {
        url,
        incognito: canOpenIncognito && incognito,
        ...getOption('editorWindowSimple') && { type: 'popup' },
        ...!IS_FIREFOX && { focused: !!active }, // FF doesn't support this
        ...storeId,
      };
      const pos = getOption('editorWindowPos');
      const hasPos = pos && 'top' in pos;
      const wnd = await browserWindows.create({ ...wndOpts, ...pos }).catch(hasPos && noop)
        || hasPos && await browserWindows.create(wndOpts);
      newTab = wnd.tabs[0];
    } else if (isInternal && canOpenIncognito && NEWTAB_URL_RE.test(getTabUrl(srcTab))) {
      // Replacing the currently focused start tab page for internal commands
      newTab = await browser.tabs.update(srcTab.id, { url, ...tabOpts }).catch(noop);
    }
    if (!newTab) {
      newTab = await browser.tabs.create({
        url,
        ...tabOpts,
        ...storeId,
        ...canOpenIncognito && {
          [kWindowId]: windowId,
          ...insert && srcTab.index != null && { index: srcTab.index + 1 },
          ...openerTabIdSupported && { openerTabId: srcTab.id },
        },
      });
    }
    if (active && newTab[kWindowId] !== windowId) {
      await browserWindows?.update(newTab[kWindowId], { focused: true });
    }
    if (!isInternal && srcTab.id != null) {
      openers[newTab.id] = srcTab.id;
    }
    return isInternal ? newTab : { id: newTab.id };
  },
  /** @return {void} */
  TabClose({ id } = {}, src) {
    const tabId = id || src?.tab?.id;
    if (tabId >= 0) browser.tabs.remove(tabId);
  },
  TabFocus(_, src) {
    browser.tabs.update(src.tab.id, { active: true }).catch(noop);
    browserWindows?.update(src.tab[kWindowId], { focused: true }).catch(noop);
  },
});

tabsOnRemoved.addListener((id) => {
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'TabClosed', id);
    delete openers[id];
  }
});

(async () => {
  // FF68+ can't fetch file:// from extension context but it runs content scripts in file:// tabs
  const fileScheme = IS_FIREFOX
    || await new Promise(r => chrome.extension.isAllowedFileSchemeAccess(r));
  fileSchemeRequestable = FIREFOX < 68 || !IS_FIREFOX && fileScheme;
  // Since users in FF can override UA we detect FF 90 via feature
  if (IS_FIREFOX && [].at || CHROME >= 88) {
    injectableRe = fileScheme ? /^(https?|file):/ : /^https?:/;
  } else if (!fileScheme) {
    injectableRe = /^(ht|f)tps?:/;
  }
})();

export async function forEachTab(callback) {
  const tabs = await browser.tabs.query({});
  let i = 0;
  for (const tab of tabs) {
    callback(tab);
    i += 1;
    // we'll run at most this many tabs in one event loop cycle
    // because hundreds of tabs would make our extension process unresponsive,
    // the same process used by our own pages like the background page, dashboard, or popups
    if (i % 20 === 0) await new Promise(setTimeout);
  }
}

/**
 * @param {string} [route] without #
 * @param {VMMessageSender} [src]
 */
export async function openDashboard(route, src) {
  const url = extensionOptionsPage + (route ? '#' + route : '');
  for (const tab of await browser.tabs.query({ url: extensionOptionsPage })) {
    const tabUrl = tab.url;
    // query() can't handle #hash so it returns tabs both with #hash and without it
    if (tabUrl === url || !route && tabUrl === url + ROUTE_SCRIPTS) {
      browserWindows?.update(tab[kWindowId], { focused: true });
      return browser.tabs.update(tab.id, { active: true });
    }
  }
  return commands.TabOpen({ url }, src);
}

/** Reloads the active tab if script matches the URL */
export async function reloadTabForScript(script) {
  const { url, id } = await getActiveTab();
  if (injectableRe.test(url) && testScript(url, script)) {
    return browser.tabs.reload(id);
  }
}
