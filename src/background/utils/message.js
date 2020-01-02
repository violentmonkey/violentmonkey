import { defaultImage, i18n, noop } from '#/common';

export const commands = {};

export function notify(options) {
  browser.notifications.create(options.id || 'ViolentMonkey', {
    type: 'basic',
    iconUrl: defaultImage,
    title: `${options.title} - ${i18n('extName')}`,
    message: options.body,
    isClickable: options.isClickable,
  });
}

export function broadcast(data) {
  forEachTab((tab) => {
    browser.tabs.sendMessage(tab.id, data)
    .catch(noop);
  });
}

export function sendMessageOrIgnore(...args) {
  return browser.runtime.sendMessage(...args).catch(noop);
}

export async function forEachTab(callback) {
  const tabs = await browser.tabs.query({});
  let i = 0;
  for (const tab of tabs) {
    callback(tab);
    i += 1;
    // we'll run at most this many tabs in one event loop cycle
    // because hundreds of tabs would make our extension process unresponsive,
    // the same process used by our own pages like the background page, dashboard, or popups
    if (i % 20 === 0) await new Promise(setTimeout);
  }
}
