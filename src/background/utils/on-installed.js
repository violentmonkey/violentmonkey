import { getUpdateInterval } from './update';

export const NEW_INSTALL = '0';
export let installedOver;

chrome.runtime.onInstalled.addListener(async ({reason, previousVersion}) => {
  if (reason === 'update' || reason === 'install') try {
    installedOver = previousVersion || NEW_INSTALL;
    if (__.MV3) await Promise.all([
      chrome.alarms.clearAll().then(() => [
        chrome.alarms.create('remove', { periodInMinutes: 24 * 60 }),
        chrome.alarms.create('update', { periodInMinutes: getUpdateInterval() / 60e3 }),
      ]),
      chrome.userScripts.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src * 'unsafe-inline' data: blob:",
        messaging: true,
      }),
      chrome.userScripts.register([{
        id: '1',
        runAt: 'document_start',
        allFrames: true,
        matches: ['<all_urls>'],
        js: [{file: 'injected-web.js'}, {file: 'injected.js'}],
      }]),
    ].flat());
  } catch (err) {
    if (__.MV3) {
      chrome.tabs.create({
        url: 'data:text/plain,' + err.message.replaceAll('#', '%23') +
          '\nMake sure to enable "Allow User Scripts" for Violentmonkey in chrome://extensions',
      });
    }
  }
});
