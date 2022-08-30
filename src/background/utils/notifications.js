import { i18n, defaultImage, sendTabCmd, trueJoin } from '#/common';
import { commands } from './message';

const openers = {};

Object.assign(commands, {
  /** @return {Promise<string>} */
  async Notification({ image, text, title }, src, bgExtras) {
    const notificationId = await browser.notifications.create({
      type: 'basic',
      title: [title, IS_FIREFOX && i18n('extName')]::trueJoin(' - '), // Chrome already shows the name
      message: text,
      iconUrl: image || defaultImage,
    });
    openers[notificationId] = bgExtras?.onClick || src.tab.id;
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
