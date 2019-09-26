import { i18n, noop } from '#/common';
import { INJECTABLE_TAB_URL_RE } from '#/common/consts';
import { forEachTab } from './message';
import { getOption, hookOptions } from './options';
import { testBlacklist } from './tester';

// Firefox Android does not support such APIs, use noop

const browserAction = [
  'setIcon',
  'setBadgeText',
  'setBadgeBackgroundColor',
  'setTitle',
].reduce((actions, key) => {
  const fn = browser.browserAction[key];
  actions[key] = fn ? fn.bind(browser.browserAction) : noop;
  return actions;
}, {});

const badges = {};
let isApplied;
let showBadge;
let titleBlacklisted;
let titleNoninjectable;

hookOptions((changes) => {
  if ('isApplied' in changes) {
    isApplied = changes.isApplied;
    setIcon();
  }
  if ('showBadge' in changes) {
    showBadge = changes.showBadge;
    forEachTab(updateBadge);
  }
  if ('blacklist' in changes) {
    forEachTab(updateState);
  }
});

global.addEventListener('backgroundInitialized', function onInit(e) {
  global.removeEventListener(e.type, onInit);
  isApplied = getOption('isApplied');
  showBadge = getOption('showBadge');
  titleBlacklisted = i18n('failureReasonBlacklisted');
  titleNoninjectable = i18n('failureReasonNoninjectable');
  forEachTab(updateState);
});

browser.tabs.onRemoved.addListener((id) => {
  delete badges[id];
});

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading') {
    updateState(tab, info.url);
  }
});

export function setBadge({ ids, reset }, src) {
  const srcTab = src.tab || {};
  let data = badges[srcTab.id];
  if (data && data.blocked) return;
  if (!data || reset) {
    data = {
      number: 0,
      unique: 0,
      idMap: {},
    };
    badges[srcTab.id] = data;
  }
  data.number += ids.length;
  if (ids) {
    ids.forEach((id) => {
      data.idMap[id] = 1;
    });
    data.unique = Object.keys(data.idMap).length;
  }
  browserAction.setBadgeBackgroundColor({
    color: '#808',
    tabId: srcTab.id,
  });
  updateBadge(srcTab, data);
}

function updateBadge(tab, data = badges[tab.id]) {
  if (!data) return;
  let text;
  if (!data.blocked) {
    if (showBadge === 'total') text = data.number;
    else if (showBadge) text = data.unique;
  }
  browserAction.setBadgeText({
    text: `${text || ''}`,
    tabId: tab.id,
  });
}

function updateState(tab, url = tab.url) {
  const tabId = tab.id;
  const injectable = INJECTABLE_TAB_URL_RE.test(url);
  const blacklisted = injectable ? testBlacklist(url) : undefined;
  const title = blacklisted && titleBlacklisted || !injectable && titleNoninjectable || '';
  // if the user unblacklisted this previously blocked tab in settings,
  // but didn't reload the tab yet, we need to restore the icon and the title
  if (title || (badges[tabId] || {}).blocked) {
    browserAction.setTitle({ title, tabId });
    const data = title ? { blocked: true } : {};
    badges[tabId] = data;
    setIcon(tab, data);
    updateBadge(tab, data);
  }
}

function setIcon(tab = {}, data = {}) {
  // modern Chrome and Firefox use 16/32, other browsers may still use 19/38 (e.g. Vivaldi)
  const mod = data.blocked && 'b' || !isApplied && 'w' || '';
  browserAction.setIcon({
    path: Object.assign({}, ...[16, 19, 32, 38].map(n => ({
      [n]: `/public/images/icon${n}${mod}.png`,
    }))),
    tabId: tab.id,
  });
}
