/** @type {chrome.userScripts} */
export const userScriptsAPI = __.MV3 && (() => {
  try { return chrome.userScripts; }
  catch { /* older versions of Chrome threw on access if no enabled */ }
});
export const executeScript = __.MV3
  ? async (tabId, code, runAt, frameId) => (await userScriptsAPI.execute({
    js: [{code}],
    injectImmediately: runAt === 'document-start' || runAt === 'document-body' || !!runAt,
    target: {tabId, frameIds: frameId == null ? undefined : [frameId]},
  }))[0].result
  : async (tabId, code, runAt, frameId) => (await browser.tabs.executeScript(tabId, {
    code,
    frameId,
    [RUN_AT]: runAt === true ? 'document_start' : runAt,
  }))[0];
