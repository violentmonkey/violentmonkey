import { i18n, defaultImage, sendTabCmd, trueJoin } from '@/common';
import { addPublicCommands, commands } from './init';
import { CHROME } from './ua';
import { vetUrl } from './url';

/** @type {{ [nid: string]: browser.runtime.MessageSender | function | number }} */
const openers = {};
const kZombie = 'zombie';
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
    if (tag) clearZombieTimer(openers[tag]);
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
      if (zombieUrl != null) src[kZombieUrl] = vetUrl(zombieUrl, src.url);
    }
    return notificationId;
  },
  RemoveNotification(nid) {
    clearZombieTimer(openers[nid]);
    removeNotification(nid);
  },
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
  } else if (op > 0) {
    if (isClick) clearZombieTimer(op);
  } else if (op[kZombie]) {
    if (isClick) {
      commands.TabOpen({ url: op[kZombieUrl] }, op);
      removeNotification(id); // Chrome doesn't auto-remove it on click
    }
  } else {
    sendTabCmd(op.tab.id, isClick ? 'NotificationClick' : 'NotificationClose', id, {
      [kFrameId]: op[kFrameId],
    });
  }
}

export function clearNotifications(tabId, frameId, tabRemoved) {
  for (const nid in openers) {
    const op = openers[nid];
    if (isObject(op)
    && op.tab.id === tabId
    && (!frameId || op[kFrameId] === frameId)
    && !op[kZombie]) {
      if (op[kZombieTimeout]) {
        op[kZombie] = setTimeout(removeNotification, op[kZombieTimeout], nid);
        if (!op[kZombieUrl]) openers[nid] = op[kZombie];
        if (tabRemoved) op._removed = true;
      } else {
        removeNotification(nid);
      }
    }
  }
}

function clearZombieTimer(op) {
  if (op > 0) clearTimeout(op);
}

function removeNotification(nid) {
  delete openers[nid];
  return browser.notifications.clear(nid);
}
