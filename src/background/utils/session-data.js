import { makePause } from '@/common';
import { kDownloads } from '@/common/consts';

export const kAlarmRemove = 'remove';
export const kAlarmSync = 'sync';
export const kAlarmUpdate = 'update';
export const kBadges = 'badges';
export const kNotifications = 'notifications';
export const kTabOpeners = 'tabOpeners';

/** @type {{ [tabId: string]: VMBadgeData }}*/
export let badges = {};
export let downloads = {};
export let notifications = {};
export let skippedTabs = {};
export let tabOpeners = {};

let flushing;
let sessionData = __.MV3 && chrome.storage.session.get().then(data => (
  badges = data[kBadges] || badges,
  downloads = data[kDownloads] || downloads,
  notifications = data[kNotifications] || notifications,
  skippedTabs = data[SKIP_SCRIPTS] || skippedTabs,
  tabOpeners = data[kTabOpeners] || tabOpeners,
  !data.init && chrome.storage.session.set({ init: 1 }),
  sessionData = data
));

export { sessionData as default };

export async function flushSession(key, val) {
  if (flushing) {
    flushing[key] = val;
  } else {
    flushing = { [key]: val };
    await makePause(1000);
    chrome.storage.session.set(flushing);
    flushing = null;
  }
}
