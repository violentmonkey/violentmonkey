import { i18n, defaultImage, sendTabCmd } from '#/common';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<string>} */
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
  RemoveNotification(notificationId) {
    return browser.notifications.clear(notificationId);
  },
});

browser.notifications.onClicked.addListener((id) => {
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'NotificationClick', id);
  }
});

browser.notifications.onClosed.addListener((id) => {
  const openerId = openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'NotificationClose', id);
    delete openers[id];
  }
});
