import { browserWindows, request, noop, i18n, getUniqId } from '@/common';
import ua from '@/common/ua';
import cache from './cache';
import { addPublicCommands, commands } from './message';
import { parseMeta, isUserScript } from './script';
import { getTabUrl } from './tabs';

const CONFIRM_URL_BASE = `${extensionRoot}confirm/index.html#`;

addPublicCommands({
  async CheckInstallerTab(tabId, src) {
    const tab = IS_FIREFOX && (src.url || '').startsWith('file:')
      && await browser.tabs.get(tabId).catch(noop);
    return tab && getTabUrl(tab).startsWith(CONFIRM_URL_BASE);
  },
  async ConfirmInstall({ code, from, url }, { tab = {} }) {
    if (!code) code = (await request(url)).data;
    // TODO: display the error in UI
    if (!isUserScript(code)) throw i18n('msgInvalidScript');
    cache.put(url, code, 3000);
    const confirmKey = getUniqId();
    const { active, id: tabId, incognito } = tab;
    // Not testing tab.pendingUrl because it will be always equal to `url`
    const canReplaceCurTab = (!incognito || IS_FIREFOX) && (
      url === from
      || cache.has(`autoclose:${tabId}`)
      || /^(chrome:\/\/(newtab|startpage)\/|about:(home|newtab))$/.test(from));
    /** @namespace VM.ConfirmCache */
    cache.put(`confirm-${confirmKey}`, { incognito, url, from, tabId, ff: ua.firefox });
    const confirmUrl = CONFIRM_URL_BASE + confirmKey;
    const { windowId } = canReplaceCurTab
      ? await browser.tabs.update(tabId, { url: confirmUrl })
      : await commands.TabOpen({ url: confirmUrl, active: !!active }, { tab });
    if (active && windowId !== tab.windowId) {
      await browserWindows?.update(windowId, { focused: true });
    }
  },
});

const whitelistRe = re`/^https:\/\/(
  (greas|sleaz)yfork\.org\/scripts\/[^/]*\/code|
  openuserjs\.org\/install\/[^/]*|
  github\.com\/[^/]*\/[^/]*\/(
    raw\/[^/]*|
    releases\/[^/]*\/download
  )|
  raw\.githubusercontent\.com(\/[^/]*){3}|
  gist\.github\.com\/.*?
)\/[^/]*?\.user\.js  ([?#]|$)  /ix`;
const blacklistRe = re`/^https?:\/\/(
  (gist\\.)?github\\.com|
  ((greas|sleaz)yfork|openuserjs)\\.org
)\//ix`;
const resolveVirtualUrl = url => (
  `${extensionOptionsPage}${ROUTE_SCRIPTS}/${+url.split('#')[1]}`
);
// FF can't intercept virtual .user.js URL via webRequest, so we redirect it explicitly
const virtualUrlRe = IS_FIREFOX && new RegExp((
  `^(view-source:)?(${extensionRoot.replace('://', '$&)?')}[^/]*\\.user\\.js#\\d+`
));
const maybeRedirectVirtualUrlFF = virtualUrlRe && ((tabId, src) => {
  if (virtualUrlRe.test(src)) {
    browser.tabs.update(tabId, { url: resolveVirtualUrl(src) });
  }
});

async function maybeInstallUserJs(tabId, url) {
  // Getting the tab now before it navigated
  const tab = tabId >= 0 && await browser.tabs.get(tabId) || {};
  const { data: code } = await request(url).catch(noop) || {};
  if (code && parseMeta(code).name) {
    commands.ConfirmInstall({ code, url, from: tab.url }, { tab });
  } else {
    cache.put(`bypass:${url}`, true, 10e3);
    if (tabId >= 0) browser.tabs.update(tabId, { url });
  }
}

if (virtualUrlRe) {
  const listener = (tabId, { url }) => url && maybeRedirectVirtualUrlFF(tabId, url);
  const apiEvent = browser.tabs.onUpdated;
  const addListener = apiEvent.addListener.bind(apiEvent, listener);
  try { addListener({ properties: ['url'] }); } catch (e) { addListener(); }
}

browser.tabs.onCreated.addListener((tab) => {
  const { id, title, url } = tab;
  /* Determining if this tab can be auto-closed (replaced, actually).
     FF>=68 allows reading file: URL only in the tab's content script so the tab must stay open. */
  if ((!url.startsWith('file:') || ua.firefox < 68)
      && /\.user\.js([?#]|$)/.test(getTabUrl(tab))) {
    cache.put(`autoclose:${id}`, true, 10e3);
  }
  if (virtualUrlRe && url === 'about:blank') {
    maybeRedirectVirtualUrlFF(id, title);
  }
});

browser.webRequest.onBeforeRequest.addListener((req) => {
  const { method, tabId, url } = req;
  if (method !== 'GET') {
    return;
  }
  // open a real URL for simplified userscript URL listed in devtools of the web page
  if (url.startsWith(extensionRoot)) {
    return { redirectUrl: resolveVirtualUrl(url) };
  }
  if (!cache.has(`bypass:${url}`)
  && (!blacklistRe.test(url) || whitelistRe.test(url))) {
    maybeInstallUserJs(tabId, url);
    return IS_FIREFOX
      ? { cancel: true } // for sites with strict CSP in FF
      : { redirectUrl: 'javascript:void 0' }; // eslint-disable-line no-script-url
  }
}, {
  urls: [
    // 1. *:// comprises only http/https
    // 2. the API ignores #hash part
    // 3. Firefox: onBeforeRequest does not work with file:// or moz-extension://
    '*://*/*.user.js',
    '*://*/*.user.js?*',
    'file://*/*.user.js',
    'file://*/*.user.js?*',
    `${extensionRoot}*.user.js`,
  ],
  types: ['main_frame'],
}, ['blocking']);
