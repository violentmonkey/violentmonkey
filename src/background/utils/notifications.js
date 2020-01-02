import { i18n, defaultImage, noop } from '#/common';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  async Notification(data, src) {
    const srcTab = src.tab || {};
    const notificationId = await browser.notifications.create({
      type: 'basic',
      title: data.title || i18n('extName'),
      message: data.text,
      iconUrl: data.image || defaultImage,
    });
    openers[notificationId] = srcTab.id;
    return notificationId;
  },
});

browser.notifications.onClicked.addListener((id) => {
  const openerId = openers[id];
  if (openerId) {
    browser.tabs.sendMessage(openerId, {
      cmd: 'NotificationClick',
      data: id,
    })
    .catch(noop);
  }
});

browser.notifications.onClosed.addListener((id) => {
  const openerId = openers[id];
  if (openerId) {
    browser.tabs.sendMessage(openerId, {
      cmd: 'NotificationClose',
      data: id,
    })
    .catch(noop);
    delete openers[id];
  }
});
