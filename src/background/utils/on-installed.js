import { registerInjector } from '@/common/browser-scripts-api';
import { kContentType, kMainFrame } from '@/common/consts';
import { DNR, DNR_ID_INSTALL } from './dnr';
import { inIncognitoContext } from './init';
import { kAlarmRemove, kAlarmUpdate } from './session-data';
import { CHROME } from './ua';
import { getUpdateInterval } from './update';

export const NEW_INSTALL = '0';
export let installedOver;

chrome.runtime.onInstalled.addListener(({reason, previousVersion}) => {
  if (reason === 'update' || reason === 'install') {
    installedOver = previousVersion || NEW_INSTALL;
    if (__.MV3 && !inIncognitoContext) {
      registerInjector(true);
      chrome.alarms.clearAll().then(() => [
        chrome.alarms.create(kAlarmRemove, { periodInMinutes: 24 * 60 }),
        chrome.alarms.create(kAlarmUpdate, { periodInMinutes: getUpdateInterval() / 60e3 }),
      ]);
      DNR.getDynamicRules().then(rules => DNR.updateDynamicRules({
        removeRuleIds: rules.map(r => r.id),
        // Suppressing the userjs installation error in Chrome < 152
        // https://chromiumdash.appspot.com/commit/38b617ca5ade59243d01170a8f4a744692983f19
        addRules: CHROME < 152 ? [{
          id: DNR_ID_INSTALL,
          condition: {
            regexFilter: '\\.user\\.js([?#].*)?$',
            requestMethods: ['get'],
            resourceTypes: [kMainFrame],
            responseHeaders: [{ header: kContentType, values: ['*/javascript*', 'text/plain*'] }],
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [{ header: kContentType, value: 'text/html', operation: 'set' }],
          },
        }] : undefined,
      }));
    }
  }
});
