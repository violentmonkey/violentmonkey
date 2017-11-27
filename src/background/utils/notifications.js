import { i18n, defaultImage } from 'src/common';

const openers = {};

browser.notifications.onClicked.addListener(id => {
  const openerId = openers[id];
  if (openerId) {
    browser.tabs.sendMessage(openerId, {
      cmd: 'NotificationClick',
      data: id,
    });
  }
});

browser.notifications.onClosed.addListener(id => {
  const openerId = openers[id];
  if (openerId) {
    browser.tabs.sendMessage(openerId, {
      cmd: 'NotificationClose',
      data: id,
    });
    delete openers[id];
  }
});

export default function createNotification(data, src) {
  const srcTab = src.tab || {};
  return browser.notifications.create({
    type: 'basic',
    title: data.title || i18n('extName'),
    message: data.text,
    iconUrl: data.image || defaultImage,
  })
  .then(notificationId => {
    openers[notificationId] = srcTab.id;
    return notificationId;
  });
}
