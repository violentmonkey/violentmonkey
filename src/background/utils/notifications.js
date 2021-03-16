import { defaultImage, sendTabCmd } from '#/common';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<string>} */
  async Notification(data, src, bgExtras = {}) {
    const { items, onClick, type } = bgExtras;
    const notificationId = await browser.notifications.create({
      type: type || 'basic',
      title: data.title || '',
      message: data.text,
      iconUrl: data.image || defaultImage,
      ...items && { items },
    });
    openers[notificationId] = onClick || src.tab.id;
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
  if (typeof openerId === 'function') {
    openerId();
  }
});

browser.notifications.onClosed.addListener((id) => {
  const openerId = openers[id];
  delete openers[id];
  if (openerId >= 0) {
    sendTabCmd(openerId, 'NotificationClose', id);
  }
});
