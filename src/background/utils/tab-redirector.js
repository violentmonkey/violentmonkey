import { browserWindows, request, noop, i18n, getUniqId } from '@/common';
import { FILE_GLOB_ALL } from '@/common/consts';
import cache from './cache';
import { addPublicCommands, commands } from './init';
import { getOption } from './options';
import { parseMeta, matchUserScript } from './script';
import { fileSchemeRequestable, getTabUrl, NEWTAB_URL_RE, tabsOnUpdated } from './tabs';
import { FIREFOX } from './ua';

addPublicCommands({
  async CheckInstallerTab(tabId, src) {
    const tab = IS_FIREFOX && (src.url || '').startsWith('file:')
      && await browser.tabs.get(tabId).catch(noop);
    return tab && getTabUrl(tab).startsWith(CONFIRM_URL_BASE);
  },
  ConfirmInstall: confirmInstall,
});

async function confirmInstall({ code, from, url, fs, parsed }, { tab = {} }) {
  if (!fs) {
    code ??= parsed
      ? request(url).then(r => r.data) // cache the Promise and start fetching now
      : (await request(url)).data;
    // TODO: display the error in UI
    if (!parsed && !matchUserScript(code)) {
      throw `${i18n('msgInvalidScript')}\n\n${
        code.trim().split(/[\r\n]+\s*/, 9/*max lines*/).join('\n')
          .slice(0, 500/*max overall length*/)
      }...`;
    }
    cache.put(url, code, 3000);
  }
  const confirmKey = getUniqId();
  const { active, id: tabId, incognito } = tab;
  // Not testing tab.pendingUrl because it will be always equal to `url`
  const canReplaceCurTab = (!incognito || IS_FIREFOX) && (
    url === from
    || cache.has(`autoclose:${tabId}`)
    || NEWTAB_URL_RE.test(from));
  /** @namespace VM.ConfirmCache */
  cache.put(`confirm-${confirmKey}`, { incognito, url, from, tabId, fs, ff: FIREFOX });
  const confirmUrl = CONFIRM_URL_BASE + confirmKey;
  const { [kWindowId]: windowId } = canReplaceCurTab
  // The tab may have been closed already, in which case we'll open a new tab
  && await browser.tabs.update(tabId, { url: confirmUrl }).catch(noop)
  || await commands.TabOpen({ url: confirmUrl, active: !!active }, { tab });
  if (active && windowId !== tab[kWindowId]) {
    await browserWindows?.update(windowId, { focused: true });
  }
}

const CONFIRM_URL_BASE = `${extensionRoot}confirm/index.html#`;
const whitelistRe = re`/^https:\/\/(
  (greas|sleaz)yfork\.org\/scripts\/[^/]*\/code|
  update\.(greas|sleaz)yfork\.org\/scripts|
  openuserjs\.org\/install\/[^/]*|
  github\.com\/[^/]*\/[^/]*\/(
    raw\/[^/]*|
    releases\/(
      download\/[^/]* |
      latest\/download
    )
  )|
  raw\.githubusercontent\.com(\/[^/]*){3}|
  gist\.github\.com\/.*?
)\/[^/]*?\.user\.js  ([?#]|$)  /ix`;
const blacklistRe = re`/^https?:\/\/(
  (gist\.)?github\.com|
  ((greas|sleaz)yfork|openuserjs)\.org
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

async function maybeInstallUserJs(tabId, url, isWhitelisted) {
  // Getting the tab now before it navigated
  const tab = tabId >= 0 && await browser.tabs.get(tabId) || {};
  const { data: code } = !isWhitelisted && await request(url).catch(noop) || {};
  if (isWhitelisted || code && parseMeta(code).name) {
    confirmInstall({ code, url, from: tab.url, parsed: true }, { tab });
  } else {
    cache.put(`bypass:${url}`, true, 10e3);
    const error = `${VIOLENTMONKEY} installer skipped ${url}.
Either not a userscript or the metablock comment is malformed:
${code?.length > 1e6 ? code.slice(0, 1e6) + '...' : code}`;
    if (tabId < 0) {
      console.warn(error);
    } else {
      browser.tabs.executeScript(tabId, {
        code: `console.warn(${JSON.stringify(error)})`,
      });
      browser.tabs.update(tabId, { url });
    }
  }
}

if (virtualUrlRe) {
  tabsOnUpdated.addListener(
    (tabId, { url }) => url && maybeRedirectVirtualUrlFF(tabId, url),
    FIREFOX && { properties: [FIREFOX >= 88 ? 'url' : 'status'] }
  );
}

browser.tabs.onCreated.addListener((tab) => {
  const { id, title } = tab;
  const url = getTabUrl(tab);
  const isFile = url.startsWith('file:');
  const isUserJS = /\.user\.js([?#]|$)/.test(url);
  /* Determining if this tab can be auto-closed (replaced, actually).
     FF>=68 allows reading file: URL only in the tab's content script so the tab must stay open. */
  if (isUserJS && (!isFile || FIREFOX < 68)) {
    cache.put(`autoclose:${id}`, true, 10e3);
  }
  if (virtualUrlRe && url === 'about:blank') {
    maybeRedirectVirtualUrlFF(id, title);
  }
  if (isUserJS && isFile && !fileSchemeRequestable && !IS_FIREFOX
  && getOption('helpForLocalFile')) {
    confirmInstall({ url, fs: true }, { tab });
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
  let isWhitelisted;
  if (!cache.has(`bypass:${url}`)
  && ((isWhitelisted = whitelistRe.test(url)) || !blacklistRe.test(url))) {
    maybeInstallUserJs(tabId, url, isWhitelisted);
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
    `${FILE_GLOB_ALL}.user.js`,
    `${FILE_GLOB_ALL}.user.js?*`,
    `${extensionRoot}*.user.js`,
  ],
  types: ['main_frame'],
}, ['blocking']);
