import { i18n, defaultImage, noop } from '#/common';

const THROTTLED_BATCH_SIZE = 20;

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

export function forEachTab(callback) {
  // we'll run the callback for each tab in a separate event loop cycle
  // because hundreds of tabs would make our extension process unresponsive,
  // the same process used by our own pages like the background page, dashboard, or popups
  browser.tabs.query({})
  .then(function throttle(tabs) {
    const num = Math.min(THROTTLED_BATCH_SIZE, tabs.length);
    for (let i = 0; i < num; i += 1) callback(tabs[i]);
    if (tabs.length > THROTTLED_BATCH_SIZE) {
      tabs.splice(0, THROTTLED_BATCH_SIZE);
      setTimeout(throttle, 0, tabs);
    }
  });
}
