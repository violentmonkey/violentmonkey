import { getActiveTab } from '@/common';

export const INJECTED_DATA_ID = '1000';
export const INJECTED_API_ID = '1001';
export const ALLOW_USERSCRIPTS = 'Please enable "Allow User Scripts" for Violentmonkey in chrome://extensions';
export const extensionDetailsUrl = __.MV3 && `chrome://extensions/?id=${chrome.runtime.id}`;

export const userScriptsAllowed = () => {
  try { return !!chrome.userScripts.register; }
  catch { /* older versions of Chrome threw on access if no enabled */ }
};

export const executeScript = __.MV3
  ? async (tabId, code, runAt, frameId) => (await chrome.userScripts.execute({
    js: [{code}],
    injectImmediately: runAt === 'document_start' || !!runAt,
    target: {tabId, frameIds: frameId == null ? undefined : [frameId]},
  }))[0].result
  : async (tabId, code, runAt, frameId) => (await browser.tabs.executeScript(tabId, {
    code,
    frameId,
    [RUN_AT]: runAt,
  }))[0];

export const registerInjector = async (isInstall) => {
  try {
    if (isInstall
      || !(await chrome.userScripts.getScripts({ ids: [INJECTED_API_ID] }))[0]?.js[0].file
    ) await Promise.all([
      chrome.userScripts.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src * 'unsafe-inline' data: blob:",
        messaging: true,
      }),
      chrome.userScripts.unregister().then(() => chrome.userScripts.register([{
        id: INJECTED_API_ID,
        runAt: 'document_start',
        allFrames: true,
        matches: ['<all_urls>'],
        js: [{ file: 'injected-web.js' }, { file: 'injected.js' }],
      }])),
    ]);
  } catch (err) {
    throw !chrome.userScripts || err.message.includes("'userScripts.getScripts' is not available")
      ? ALLOW_USERSCRIPTS
      : err;
  }
};

export const openExtensionDetails = async () => {
  const url = extensionDetailsUrl;
  const tab = await getActiveTab();
  if (tab?.url?.split('://')[1] !== url.split('://')[1]) {
    chrome.tabs.create({
      url,
      index: tab?.index + 1,
      openerTabId: tab?.id,
    });
  }
};
