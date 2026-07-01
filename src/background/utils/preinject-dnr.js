import { BLOB_LIFE, kMainFrame, kSubFrame } from '@/common/consts';
import { sessionData } from './init';
import callOffscreen from './offscreen';
import { makeXhrHeader } from './preinject-core';

export const DNR = chrome.declarativeNetRequest;

if (__.MV3 && __.DEV) {
  DNR.onRuleMatchedDebug?.addListener(console.log.bind(null, 'DNR'));
}

export async function registerDnrBlob(blob, url, tabId, frameId) {
  const h = makeXhrHeader('header', await callOffscreen('LeaseBlobUrl', blob));
  const ruleId = frameId || tabId;
  const dnr = sessionData.dnr ||= {};
  clearTimeout(dnr[ruleId]);
  dnr[ruleId] = setTimeout(revokeDnrRules, BLOB_LIFE, ruleId);
  h.operation = 'append';
  return DNR.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      condition: {
        tabIds: [tabId],
        urlFilter: '|' + url + '|',
        resourceTypes: [frameId ? kSubFrame : kMainFrame],
        // 1. Skipping XML document as it's re-rendered in Chrome at DOMContentLoaded
        // 2. Forcing the rule to be applied to the already loading HTML document
        excludedResponseHeaders: [{ header: 'content-type', values: ['*/xml*'] }],
      },
      action: {
        type: 'modifyHeaders',
        responseHeaders: [h],
      },
    }],
  });
}

export function revokeDnrRules(what) {
  let dnr;
  if (typeof what === 'number') {
    dnr = sessionData.dnr ||= {};
    delete dnr[what];
    what = [what];
  } else if (!what.length) {
    return;
  } else {
    dnr = sessionData.dnr = {};
  }
  chrome.storage.session.set({ dnr });
  DNR.updateSessionRules({ removeRuleIds: what });
}
