import { i18n, defaultImage, noop } from '#/common';

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
  browser.tabs.query({})
  .then((tabs) => {
    tabs.forEach((tab) => {
      browser.tabs.sendMessage(tab.id, data)
      .catch(noop);
    });
  });
}

export function sendMessageOrIgnore(...args) {
  return browser.runtime.sendMessage(...args).catch(noop);
}
