import {
  browserWindows, request, noop, i18n, getUniqId, tryUrl,
} from '@/common';
import { FILE_GLOB_ALL } from '@/common/consts';
import cache from './cache';
import { logBackgroundAction, logBackgroundError } from './diagnostics';
import { addPublicCommands, commands } from './init';
import { getOption } from './options';
import { parseMeta, matchUserScript } from './script';
import {
  executeScriptInTab,
  fileSchemeRequestable,
  getTabUrl,
  NEWTAB_URL_RE,
  tabsOnUpdated,
} from './tabs';
import { FIREFOX } from './ua';
const IS_MV3 = extensionManifest.manifest_version === 3;
const CAN_BLOCK_INSTALL_INTERCEPT = IS_FIREFOX || !IS_MV3;
const CAN_USE_DNR_INSTALL_INTERCEPT = IS_MV3 && !!browser.declarativeNetRequest?.updateSessionRules;
const USERJS_URL_RE = /\.user\.js([?#]|$)/;
const DNR_INSTALL_RULE_ID = 940001;
const DNR_INSTALL_REGEX_FILTERS = [
  '^https:\\/\\/update\\.(?:greasy|sleazy)fork\\.(?:org|cc)\\/scripts\\/[^?#]*\\.user\\.js(?:[?#].*)?$',
  '^https:\\/\\/(?:greasy|sleazy)fork\\.(?:org|cc)\\/(?:[a-z]{2}(?:-[A-Z]{2})?\\/)?scripts\\/[^/]+\\/code\\/[^?#]*\\.user\\.js(?:[?#].*)?$',
  '^https:\\/\\/openuserjs\\.org\\/install\\/[^?#]*\\.user\\.js(?:[?#].*)?$',
  '^https:\\/\\/github\\.com\\/[^/]+\\/[^/]+\\/(?:raw\\/[^?#]*|releases\\/(?:download\\/[^/]+|latest\\/download)\\/[^?#]*)\\.user\\.js(?:[?#].*)?$',
  '^https:\\/\\/raw\\.githubusercontent\\.com\\/[^?#]*\\.user\\.js(?:[?#].*)?$',
  '^https:\\/\\/gist\\.github\\.com\\/[^?#]*\\.user\\.js(?:[?#].*)?$',
];
const DNR_INSTALL_RULE_IDS = DNR_INSTALL_REGEX_FILTERS.map((_, i) => DNR_INSTALL_RULE_ID + i);

function logInstallAction(event, details, level = 'info') {
  try {
    logBackgroundAction(event, details, level);
  } catch (e) {
    // diagnostics is best-effort and must never break install routing
  }
}

function logInstallError(event, error, details, options = {}) {
  try {
    logBackgroundError(event, error, details, { alert: false, ...options });
  } catch (e) {
    // diagnostics is best-effort and must never break install routing
  }
}

addPublicCommands({
  async CheckInstallerTab(tabId, src) {
    const tab = IS_FIREFOX && (src.url || '').startsWith('file:')
      && await browser.tabs.get(tabId).catch(noop);
    return tab && getTabUrl(tab).startsWith(CONFIRM_URL_BASE);
  },
  ConfirmInstall: confirmInstall,
});

async function confirmInstall({ code, from, url, fs, parsed }, { tab = {} }) {
  const requestedUrl = url;
  let resolution = 'passthrough';
  if (!fs) {
    ({ code, url, resolution } = await resolveInstallPayload({ code, parsed, url }));
    logInstallAction('install.payload.resolved', {
      parsed: !!parsed,
      requestedUrl,
      resolvedUrl: url,
      resolution,
      hasMetaBlock: !!matchUserScript(code),
    });
    // TODO: display the error in UI
    if (!matchUserScript(code)) {
      const preview = formatInvalidScriptPreview(code);
      logInstallError('install.payload.invalid', i18n('msgInvalidScript'), {
        requestedUrl,
        resolvedUrl: url,
        resolution,
        preview,
        phase: 'validate',
      }, {
        source: 'background',
        phase: 'validate',
      });
      throw `${i18n('msgInvalidScript')}\n\n${
        preview
      }...`;
    }
    cache.put(url, code, 3000);
  }
  const confirmKey = getUniqId();
  const { active, id: tabId, incognito } = tab;
  // Not testing tab.pendingUrl because it will be always equal to `url`
  const canReplaceCurTab = (!incognito || IS_FIREFOX) && (
    url === from
    || requestedUrl === from
    || cache.has(`autoclose:${tabId}`)
    || NEWTAB_URL_RE.test(from));
  /** @namespace VM.ConfirmCache */
  cache.put(`confirm-${confirmKey}`, { incognito, url, from, tabId, fs, ff: FIREFOX });
  const confirmUrl = CONFIRM_URL_BASE + confirmKey;
  const { [kWindowId]: windowId } = canReplaceCurTab
  // The tab may have been closed already, in which case we'll open a new tab
  && await browser.tabs.update(tabId, { url: confirmUrl }).catch(noop)
  || await commands.TabOpen({ url: confirmUrl, active: !!active }, { tab });
  logInstallAction('install.confirm.opened', {
    requestedUrl,
    resolvedUrl: url,
    from,
    tabId,
    canReplaceCurTab,
    confirmUrl,
    resolution,
  });
  if (active && windowId !== tab[kWindowId]) {
    await browserWindows?.update(windowId, { focused: true });
  }
}

async function resolveInstallPayload({ code, parsed, url }) {
  const requestedUrl = url;
  let resolvedUrl = url;
  let resolvedCode = code ?? (parsed
    ? await request(url).then(r => r.data) // cache-like eager path for parsed sources
    : (await request(url)).data);
  let resolution = 'direct-response';
  if (!matchUserScript(resolvedCode)) {
    const scriptUrl = getScriptUrlFromMetadataPayload(resolvedCode, url);
    if (scriptUrl && scriptUrl !== url) {
      const payload = await request(scriptUrl).then(r => r.data).catch(noop);
      if (payload && matchUserScript(payload)) {
        resolvedCode = payload;
        resolvedUrl = scriptUrl;
        resolution = 'metadata-code-url';
      } else {
        resolution = 'metadata-code-url-invalid';
      }
    } else {
      resolution = 'invalid-payload';
    }
  } else {
    resolution = 'direct-userscript';
  }
  return {
    code: resolvedCode,
    url: resolvedUrl,
    requestedUrl,
    resolution,
  };
}

function formatInvalidScriptPreview(code) {
  return `${code || ''}`.trim()
    .split(/[\r\n]+\s*/, 9/*max lines*/)
    .join('\n')
    .slice(0, 500/*max overall length*/);
}

function getScriptUrlFromMetadataPayload(payload, baseUrl) {
  const meta = parseInstallMetadataPayload(payload);
  const codeUrl = meta?.code_url
    || meta?.codeUrl
    || meta?.script?.code_url
    || meta?.script?.codeUrl;
  const resolved = codeUrl && tryUrl(codeUrl, baseUrl);
  return resolved && USERJS_URL_RE.test(resolved) ? resolved : '';
}

function parseInstallMetadataPayload(payload) {
  const text = `${payload || ''}`.trim();
  if (!text) return;
  const jsonp = text.match(/^(?:\/\*\*\/\s*)?(?:[\w$.]+)\(([\s\S]*)\)\s*;?\s*$/);
  const jsonText = (jsonp ? jsonp[1] : text).trim();
  if (!/^[{[]/.test(jsonText)) return;
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // not JSON metadata
  }
}

const CONFIRM_URL_BASE = `${extensionRoot}confirm/index.html#`;
const whitelistRe = re`/^https:\/\/(
  (greas|sleaz)yfork\.(org|cc)\/([a-z]{2}(-[A-Z]{2})?\/)?scripts\/[^/]*\/code|
  update\.(greas|sleaz)yfork\.(org|cc)\/scripts|
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
  ((greas|sleaz)yfork|openuserjs)\.(org|cc)
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
  logInstallAction('install.route.intercepted', {
    url,
    tabId,
    isWhitelisted: !!isWhitelisted,
    mode: CAN_BLOCK_INSTALL_INTERCEPT ? 'blocking' : 'mv3-fallback',
  });
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
      logInstallAction('install.route.fallback.invalid', {
        url,
        tabId,
        reason: 'invalid-userscript-payload',
      }, 'warn');
      commands.Notification?.({
        title: VIOLENTMONKEY,
        text: `${i18n('msgInvalidScript')}\n${url}`,
      });
      executeScriptInTab(tabId, {
        code: `console.warn(${JSON.stringify(error)})`,
        tryUserScripts: IS_MV3,
        allowRegisterFallback: false,
        allowLegacyCodeFallback: false,
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

const onUserJsRequest = (req) => {
  const { method, tabId, url } = req;
  if (method !== 'GET') {
    return;
  }
  logInstallAction('install.request.detected', {
    tabId,
    url,
  });
  // open a real URL for simplified userscript URL listed in devtools of the web page
  if (url.startsWith(extensionRoot)) {
    logInstallAction('install.request.virtual', {
      tabId,
      url,
    });
    if (!CAN_BLOCK_INSTALL_INTERCEPT && tabId >= 0) {
      browser.tabs.update(tabId, { url: resolveVirtualUrl(url) });
    }
    return { redirectUrl: resolveVirtualUrl(url) };
  }
  let isWhitelisted;
  if (!cache.has(`bypass:${url}`)
  && ((isWhitelisted = whitelistRe.test(url)) || !blacklistRe.test(url))) {
    logInstallAction('install.request.accepted', {
      tabId,
      url,
      isWhitelisted: !!isWhitelisted,
    });
    maybeInstallUserJs(tabId, url, isWhitelisted);
    // Using a real document URL avoids CSP errors from javascript: redirects in strict pages.
    return CAN_BLOCK_INSTALL_INTERCEPT && { redirectUrl: 'about:blank' };
  }
  logInstallAction('install.request.ignored', {
    tabId,
    url,
  });
};
const userJsFilter = {
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
};
async function updateInstallDnrRules() {
  if (!CAN_USE_DNR_INSTALL_INTERCEPT) return;
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: DNR_INSTALL_RULE_IDS,
      addRules: DNR_INSTALL_REGEX_FILTERS.map((regexFilter, i) => ({
        id: DNR_INSTALL_RULE_IDS[i],
        priority: 1,
        action: { type: 'block' },
        condition: {
          regexFilter,
          resourceTypes: ['main_frame'],
        },
      })),
    });
  } catch (e) {
    if (process.env.DEBUG) {
      console.warn('MV3 DNR install interception setup failed.', e);
    }
  }
}
if (CAN_BLOCK_INSTALL_INTERCEPT) {
  browser.webRequest.onBeforeRequest.addListener(onUserJsRequest, userJsFilter, ['blocking']);
} else {
  // MV3 path: apply DNR blocking on trusted installer sources, then use tab update flow.
  updateInstallDnrRules();
  const onTabUpdated = (tabId, { url }) => {
    if (!url || !USERJS_URL_RE.test(url)) return;
    onUserJsRequest({ method: 'GET', tabId, url });
  };
  try {
    tabsOnUpdated.addListener(onTabUpdated, { properties: ['url'] });
  } catch (e) {
    tabsOnUpdated.addListener(onTabUpdated);
  }
}
