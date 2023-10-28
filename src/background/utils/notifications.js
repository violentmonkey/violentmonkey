import { i18n, defaultImage, sendTabCmd, trueJoin, getFullUrl } from '@/common';
import { addPublicCommands, commands } from './init';
import { CHROME } from './ua';

/** @type {{ [nid: string]: browser.runtime.MessageSender | function }} */
const openers = {};
const kZombieTimeout = 'zombieTimeout';
const kZombieUrl = 'zombieUrl';

addPublicCommands({
  /** @return {Promise<string>} */
  async Notification({
    image,
    text,
    tag,
    title,
    silent,
    onclick,
    [kZombieUrl]: zombieUrl,
    [kZombieTimeout]: zombieTimeout,
  }, src) {
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
    if (isFunction(onclick)) {
      openers[notificationId] = onclick;
    } else if (src) {
      openers[notificationId] = src;
      if (+zombieTimeout > 0) src[kZombieTimeout] = +zombieTimeout;
      if (zombieUrl != null) src[kZombieUrl] = getFullUrl(zombieUrl, src.url);
    }
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
  if (!op) return;
  if (isFunction(op)) {
    if (isClick) op();
  } else if (op[kZombieTimeout] === -1) {
    if (isClick) commands.TabOpen({ url: op[kZombieUrl] }, op);
  } else {
    sendTabCmd(op.tab.id, isClick ? 'NotificationClick' : 'NotificationClose', id, {
      [kFrameId]: op[kFrameId],
    });
  }
}

export function clearNotifications(tabId, frameId) {
  for (const nid in openers) {
    const op = openers[nid];
    if (op.tab.id === tabId && (!frameId || op[kFrameId] === frameId)) {
      if (op[kZombieTimeout]) {
        setTimeout(removeNotification, op[kZombieTimeout], nid);
        if (op[kZombieUrl]) op[kZombieTimeout] = -1;
        else delete openers[nid];
      } else {
        removeNotification(nid);
      }
    }
  }
}

function removeNotification(nid) {
  delete openers[nid];
  return browser.notifications.clear(nid);
}
