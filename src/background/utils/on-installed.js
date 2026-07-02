import { kContentType, kMainFrame } from '@/common/consts';
import { userScriptsAPI } from '@/common/browser-scripts-api';
import { DNR, DNR_ID_INSTALL } from './dnr';
import { kAlarmRemove, kAlarmUpdate } from './session-data';
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
        chrome.alarms.create(kAlarmRemove, { periodInMinutes: 24 * 60 }),
        chrome.alarms.create(kAlarmUpdate, { periodInMinutes: getUpdateInterval() / 60e3 }),
      ]),
      userScriptsAPI.configureWorld({
        csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src * 'unsafe-inline' data: blob:",
        messaging: true,
      }),
      userScriptsAPI.unregister().then(() => userScriptsAPI.register([{
        id: INJECTED_API_ID,
        runAt: 'document_start',
        allFrames: true,
        matches: ['<all_urls>'],
        js: [{file: 'injected-web.js'}, {file: 'injected.js'}],
      }])),
      DNR.getDynamicRules().then(rules => DNR.updateDynamicRules({
        removeRuleIds: rules.map(r => r.id),
        addRules: [{
          id: DNR_ID_INSTALL,
          condition: {
            regexFilter: '\\.user\\.js(\\?.*)?$',
            requestMethods: ['get'],
            resourceTypes: [kMainFrame],
            responseHeaders: [{ header: kContentType, values: ['*/javascript*'] }],
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [{ header: kContentType, value: 'text/html', operation: 'set' }],
          },
        }],
      }))
    ].flat());
  } catch (err) {
    if (__.MV3) {
      chrome.tabs.create({
        url: `data:text/plain,${
          userScriptsAPI ? err.stack.replaceAll('#', '%23') :
            'Make sure to enable "Allow User Scripts" for Violentmonkey in chrome://extensions'
        }`,
      });
    }
  }
});
