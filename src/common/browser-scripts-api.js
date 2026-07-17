import { getActiveTab } from '@/common';

export const INJECTED_DATA_ID = '1000';
export const INJECTED_API_ID = '1001';
export const extensionDetailsUrl = __.MV3 && `chrome://extensions/?id=${chrome.runtime.id}`;

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
  let api;
  try {
    api = chrome.userScripts;
    if (isInstall
      || !(await api.getScripts({ ids: [INJECTED_API_ID] }))[0]?.js[0].file
    ) await Promise.all([
      api.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src * 'unsafe-inline' data: blob:",
        messaging: true,
      }),
      api.unregister().then(() => api.register([{
        id: INJECTED_API_ID,
        runAt: 'document_start',
        allFrames: true,
        matches: ['<all_urls>'],
        js: [{ file: 'injected-web.js' }, { file: 'injected.js' }],
      }])),
    ]);
  } catch (err) {
    throw !api || err.message.includes("'userScripts.getScripts' is not available")
      ? `Please enable ${
        +navigator.userAgent.match(/chrom\D+(\d{3,})/i)?.[1] >= 138
          ? '"Allow User Scripts" in details for Violentmonkey'
          : '"Developer Mode"'
      } in chrome://extensions`
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
