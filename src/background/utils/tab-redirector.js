import { request, noop, i18n, getUniqId } from '#/common';
import ua from '#/common/ua';
import cache from './cache';
import { extensionRoot } from './init';
import { commands } from './message';
import { parseMeta, isUserScript } from './script';

const CONFIRM_URL_BASE = `${extensionRoot}confirm/index.html#`;

Object.assign(commands, {
  async CheckInstallerTab(tabId, src) {
    const tab = IS_FIREFOX && (src.url || '').startsWith('file:')
      && await browser.tabs.get(tabId).catch(noop);
    return tab && (tab.pendingUrl || tab.url || '').startsWith(CONFIRM_URL_BASE);
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
    /** @namespace VMConfirmCache */
    cache.put(`confirm-${confirmKey}`, { incognito, url, from, tabId, ff: ua.firefox });
    const confirmUrl = CONFIRM_URL_BASE + confirmKey;
    const { windowId } = canReplaceCurTab
      ? await browser.tabs.update(tabId, { url: confirmUrl })
      : await commands.TabOpen({ url: confirmUrl, active: !!active }, { tab });
    if (active && windowId !== tab.windowId) {
      await browser.windows.update(windowId, { focused: true });
    }
  },
});

const whitelistRe = new RegExp(`^https://(${
  [
    'greasyfork\\.org/scripts/%/code/',
    'openuserjs\\.org/install/%/',
    'github\\.com/%/%/raw/%/',
    'github\\.com/%/%/releases/%/download/',
    'raw\\.githubusercontent\\.com(/%){3}/',
    'gist\\.github\\.com/.*?/',
  ].join('|')
})%?\\.user\\.js([?#]|$)`.replace(/%/g, '[^/]*'));
const blacklistRe = new RegExp(`^https://(${
  [
    '(gist\\.)?github\\.com',
    'greasyfork\\.org',
    'openuserjs\\.org',
  ].join('|')
})/`);
const resolveVirtualUrl = url => (
  `${extensionRoot}options/index.html#scripts/${+url.split('#')[1]}`
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
  const { data: code } = await request(url).catch(noop) || {};
  if (code && parseMeta(code).name) {
    const tab = tabId >= 0 && await browser.tabs.get(tabId) || {};
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
      && /\.user\.js([?#]|$)/.test(tab.pendingUrl || url)) {
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
    return { redirectUrl: 'javascript:void 0' }; // eslint-disable-line no-script-url
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
