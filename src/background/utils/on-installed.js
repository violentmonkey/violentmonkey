import { userScriptsAPI } from '@/common/browser-scripts-api';
import { sessionData } from './init';
import { DNR, revokeDnrRules } from './preinject-dnr';
import { getUpdateInterval } from './update';

export const NEW_INSTALL = '0';
export const INJECTED_DATA_ID = '1000';
export const INJECTED_API_ID = '1001';
export let installedOver;

chrome.runtime.onInstalled.addListener(async ({reason, previousVersion}) => {
  if (reason === 'update' || reason === 'install') try {
    installedOver = previousVersion || NEW_INSTALL;
    if (__.MV3) await Promise.all([
      chrome.alarms.clearAll().then(() => [
        chrome.alarms.create('remove', { periodInMinutes: 24 * 60 }),
        chrome.alarms.create('update', { periodInMinutes: getUpdateInterval() / 60e3 }),
      ]),
      userScriptsAPI.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src * 'unsafe-inline' data: blob:",
        messaging: true,
      }),
      userScriptsAPI.register([{
        id: INJECTED_API_ID,
        runAt: 'document_start',
        allFrames: true,
        matches: ['<all_urls>'],
        js: [{file: 'injected-web.js'}, {file: 'injected.js'}],
      }]),
      DNR.getSessionRules().then(rules =>
        revokeDnrRules(rules.map(r => !sessionData[r.id] && r.id).filter(Boolean)))
    ].flat());
  } catch (err) {
    if (__.MV3) {
      chrome.tabs.create({
        url: 'data:text/plain,' + err.stack.replaceAll('#', '%23') + (userScriptsAPI ? '' :
          '\nMake sure to enable "Allow User Scripts" for Violentmonkey in chrome://extensions'),
      });
    }
  }
});
