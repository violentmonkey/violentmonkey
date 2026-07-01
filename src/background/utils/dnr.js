import { BLOB_LIFE, kContentType, kMainFrame, kSubFrame } from '@/common/consts';
import callOffscreen from './offscreen';
import { makeXhrHeader } from './preinject-core';

/** @type {chrome.declarativeNetRequest} */
export const DNR = __.MV3 && chrome.declarativeNetRequest;
export const DNR_ID_INSTALL = 100;
export const DNR_ID_BLOB = 1e6;
export const DNR_ID_XHR = 2e6;
export let blobRules = {};
export let blobTabs = {};
export let xhrRules = {};

/**
 * @param {number | number[]} id
 * @param {chrome.declarativeNetRequest.RuleCondition} [condition]
 * @param {chrome.declarativeNetRequest.RuleAction} [action]
 * @return {Promise<void>}
 */
export const updateSessionRules = (id, condition, action) => DNR.updateSessionRules({
  removeRuleIds: Array.isArray(id) ? id : [id],
  addRules: condition && [{ id, condition, action }],
});

if (__.MV3) {
  if (__.DEV) DNR.onRuleMatchedDebug?.addListener(console.log.bind(null, 'DNR'));
  (async () => {
    const ids = (await DNR.getSessionRules()).map(r => !blobRules[r.id] && r.id).filter(Boolean);
    if (ids.length) updateSessionRules(ids);
  })();
}

export async function registerDnrBlob(blob, url, tabId, frameId) {
  const h = makeXhrHeader('header', await callOffscreen('LeaseBlob', blob));
  const key = tabId + ':' + frameId;
  let ruleId = blobTabs[key];
  if (ruleId) {
    clearTimeout(blobRules[ruleId]);
  } else {
    ruleId = DNR_ID_BLOB;
    while (blobRules[ruleId]) ruleId++;
    blobTabs[key] = ruleId;
  }
  blobRules[ruleId] = setTimeout(revokeBlobRules, BLOB_LIFE, key, ruleId);
  h.operation = 'append';
  return updateSessionRules(ruleId, {
    tabIds: [tabId],
    urlFilter: '|' + url + '|',
    resourceTypes: [frameId ? kSubFrame : kMainFrame],
    // 1. Skipping XML document as it's re-rendered in Chrome at DOMContentLoaded
    // 2. Forcing the rule to be applied to the already loading HTML document
    excludedResponseHeaders: [{ header: kContentType, values: ['*/xml*'] }],
  }, {
    type: 'modifyHeaders',
    responseHeaders: [h],
  });
}

export function revokeBlobRules(key, ruleId) {
  if (ruleId) {
    delete blobTabs[key];
    delete blobRules[ruleId];
    updateSessionRules([ruleId]);
  } else if ((key = Object.keys(blobRules)).length) {
    updateSessionRules(key.map(Number));
    for (ruleId in blobRules)
      clearTimeout(blobRules[ruleId]);
    blobRules = {};
    blobTabs = {};
  }
}
