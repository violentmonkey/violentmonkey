import { i18n, defaultImage, sendTabCmd, trueJoin } from '@/common';
import { addPublicCommands } from './init';
import { CHROME } from './ua';

const openers = {};
const removeNotification = id => browser.notifications.clear(id);

addPublicCommands({
  /** @return {Promise<string>} */
  async Notification({ image, text, tag, title, silent, onclick, zombieTimeout }, src) {
    const notificationId = await browser.notifications.create(tag, {
      type: 'basic',
      title: [title, IS_FIREFOX && i18n('extName')]::trueJoin(' - '), // Chrome already shows the name
      message: text,
      iconUrl: image || defaultImage,
      ...!IS_FIREFOX && {
        requireInteraction: !!onclick,
      },
      ...CHROME >= 70 && {
        silent,
      }
    });
    const op = isFunction(onclick) ? onclick : src && [
      src.tab.id,
      src[kFrameId],
      +zombieTimeout > 0 ? +zombieTimeout : 0,
    ];
    if (op) openers[notificationId] = op;
    return notificationId;
  },
  RemoveNotification: removeNotification,
});

browser.notifications.onClicked.addListener((id) => {
  notifyOpener(id, true);
});

browser.notifications.onClosed.addListener((id) => {
  notifyOpener(id, false);
  delete openers[id];
});

function notifyOpener(id, isClick) {
  const op = openers[id];
  if (isFunction(op)) {
    if (isClick) op();
  } else if (op) {
    sendTabCmd(op[0], isClick ? 'NotificationClick' : 'NotificationClose', id, {
      [kFrameId]: op[1],
    });
  }
}

export function clearNotifications(tabId, frameId) {
  for (const nid in openers) {
    const op = openers[nid];
    if (op[0] === tabId && (!frameId || op[1] === frameId)) {
      if (op[2]) setTimeout(removeNotification, op[2], nid);
      else removeNotification(nid);
      delete openers[nid];
    }
  }
}
