import { browserWindows, getActiveTab, noop, sendTabCmd, getFullUrl } from '@/common';
import ua from '@/common/ua';
import { addOwnCommands, addPublicCommands, commands } from './message';
import { getOption } from './options';

const openers = {};
const openerTabIdSupported = !IS_FIREFOX // supported in Chrome
  || !!(window.AbortSignal && browser.windows); // and FF57+ except mobile
const NEWTAB_URL_RE = re`/
^(
  about:(home|newtab) # Firefox
  | (chrome|edge):\/\/(
    newtab\/ # Chrome, Edge
    | startpageshared\/ # Opera
    | vivaldi-webui\/startpage # Vivaldi
  )
)$
/x`;
/**
 * @param {chrome.tabs.Tab} tab
 * @returns {string}
 */
export const getTabUrl = tab => (
  tab.pendingUrl || tab.url || ''
);
let cookieStorePrefix;

addOwnCommands({
  /**
   * @param {string} [pathId] - path or id to add to #scripts route in dashboard,
     if absent a new script will be created for active tab's URL
     if '' the script list is opened, TODO: move to a new command for clarity?
   * @returns {Promise<chrome.tabs.Tab>}
   */
  async OpenEditor(pathId, src) {
    if (pathId == null) {
      const { tab, domain } = await commands.GetTabDomain();
      const id = domain && commands.CacheNewScript({
        url: getTabUrl(tab).split(/[#?]/)[0],
        name: `${getOption('scriptTemplateEdited') ? '' : '- '}${domain}`,
      });
      pathId = `_new${id ? `/${id}` : ''}`;
    }
    let url = extensionOptionsPage;
    if (pathId) url += `${ROUTE_SCRIPTS}/${pathId}`;
    // Firefox until v56 doesn't support moz-extension:// pattern in browser.tabs.query()
    for (const view of browser.extension.getViews()) {
      const viewUrl = view.location.href;
      if (viewUrl === url || !pathId && viewUrl === url + ROUTE_SCRIPTS) {
        const { id: tabId, windowId } = await view.browser.tabs.getCurrent();
        browserWindows?.update(windowId, { focused: true });
        return browser.tabs.update(tabId, { active: true });
      }
    }
    return commands.TabOpen({ url, maybeInWindow: !!pathId }, src);
  },
});

addPublicCommands({
  /** @return {Promise<{ id: number } | chrome.tabs.Tab>} new tab is returned for internal calls */
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
    const canOpenIncognito = !incognito || IS_FIREFOX || !/^(chrome[-\w]*):/.test(url);
    const tabOpts = {
      // normalizing as boolean because the API requires strict types
      active: !!active,
      pinned: !!pinned,
    };
    let newTab;
    // Chrome can't open chrome-xxx: URLs in incognito windows
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
    if (maybeInWindow
        && browserWindows
        && getOption('editorWindow')
        /* cookieStoreId in windows.create() is supported since FF64 https://bugzil.la/1393570
         * and a workaround is too convoluted to add it for such an ancient version */
        && (!storeId || ua.firefox >= 64)) {
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
          windowId,
          ...insert && { index: srcTab.index + 1 },
          ...openerTabIdSupported && { openerTabId: srcTab.id },
        },
      });
    }
    if (active && newTab.windowId !== windowId) {
      await browserWindows?.update(newTab.windowId, { focused: true });
    }
    if (!isInternal) {
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
    browserWindows?.update(src.tab.windowId, { focused: true }).catch(noop);
  },
});

browser.tabs.onRemoved.addListener((id) => {
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'TabClosed', id);
    delete openers[id];
  }
});
