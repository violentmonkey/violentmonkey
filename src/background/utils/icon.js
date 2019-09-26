import { noop } from '#/common';
import { getOption, hookOptions } from './options';

// Firefox Android does not support such APIs, use noop

const browserAction = [
  'setIcon',
  'setBadgeText',
  'setBadgeBackgroundColor',
].reduce((actions, key) => {
  const fn = browser.browserAction[key];
  actions[key] = fn ? fn.bind(browser.browserAction) : noop;
  return actions;
}, {});

const badges = {};

hookOptions((changes) => {
  if ('isApplied' in changes) setIcon(changes.isApplied);
  if ('showBadge' in changes) updateBadges();
});

export function setBadge({ ids, reset }, src) {
  const srcTab = src.tab || {};
  let data = !reset && badges[srcTab.id];
  if (!data) {
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
  updateBadge(srcTab.id);
}
function updateBadge(tabId) {
  const data = badges[tabId];
  if (data) {
    const showBadge = getOption('showBadge');
    let text;
    if (showBadge === 'total') text = data.number;
    else if (showBadge) text = data.unique;
    browserAction.setBadgeText({
      text: `${text || ''}`,
      tabId,
    });
  }
}
function updateBadges() {
  browser.tabs.query({})
  .then((tabs) => {
    tabs.forEach((tab) => {
      updateBadge(tab.id);
    });
  });
}
browser.tabs.onRemoved.addListener((id) => {
  delete badges[id];
});

function setIcon(isApplied) {
  // modern Chrome and Firefox use 16/32, other browsers may still use 19/38 (e.g. Vivaldi)
  browserAction.setIcon({
    path: Object.assign({}, ...[16, 19, 32, 38].map(n => ({
      [n]: `/public/images/icon${n}${isApplied ? '' : 'w'}.png`,
    }))),
  });
}
setIcon(getOption('isApplied'));
