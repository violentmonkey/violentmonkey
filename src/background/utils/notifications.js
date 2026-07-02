import { i18n, defaultImage, sendTabCmd, trueJoin } from '@/common';
import { addPublicCommands, commands, init } from './init';
import sessionData, { flushSession, kNotifications, notifications } from './session-data';
import { vetUrl } from './url';

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
    if (tag) clearZombieTimer(notifications[tag]);
    const notificationId = await browser.notifications.create(tag, {
      type: 'basic',
      title: [title, IS_FIREFOX && i18n('extName')]::trueJoin(' - '), // Chrome already shows the name
      message: text,
      iconUrl: image || defaultImage,
      ...!IS_FIREFOX && {
        requireInteraction: !!onclick,
      },
      silent,
    });
    if (src) {
      const op = notifications[notificationId] = {
        tabId: src.tab?.id,
        [kFrameId]: src[kFrameId],
      };
      if (+zombieTimeout > 0) op[kZombieTimeout] = +zombieTimeout;
      if (zombieUrl != null) op[kZombieUrl] = vetUrl(zombieUrl, src.url);
      if (__.MV3) flushSession(kNotifications, notifications);
    } else if (onclick) {
      notifications[notificationId] = onclick;
      if (__.MV3) flushSession(kNotifications, notifications);
    }
    return notificationId;
  },
  RemoveNotification(nid) {
    clearZombieTimer(notifications[nid]);
    removeNotification(nid);
  },
});

browser.notifications.onClicked.addListener((id) => notifyOpener(id, true));

browser.notifications.onClosed.addListener((id) => notifyOpener(id, false));

async function notifyOpener(id, isClick) {
  if (init) await sessionData;
  const op = notifications[id];
  if (!op) return;
  if (op.cmd) {
    if (isClick) op.for.forEach(arg => commands[op.cmd](arg));
  } else if (op > 0) {
    if (isClick) clearZombieTimer(op);
  } else if (op[kZombie]) {
    if (isClick) {
      commands.TabOpen({ url: op[kZombieUrl] }, op);
    }
  } else {
    sendTabCmd(op.tabId, isClick ? 'NotificationClick' : 'NotificationClose', id, {
      [kFrameId]: op[kFrameId],
    });
  }
  if (isClick) {
    removeNotification(id); // Chrome doesn't auto-remove it on click
  } else {
    delete notifications[id];
    if (__.MV3) flushSession(kNotifications, notifications);
  }
}

export function clearNotifications(tabId, frameId, tabRemoved) {
  for (const nid in notifications) {
    const op = notifications[nid];
    if (isObject(op)
    && op.tabId === tabId
    && (!frameId || op[kFrameId] === frameId)
    && !op[kZombie]) {
      const timeout = op[kZombieTimeout];
      if (timeout) {
        if (__.MV3) chrome.alarms.create(kNotifications + nid, { when: Date.now() + timeout });
        op[kZombie] = setTimeout(removeNotification, timeout, nid);
        if (!op[kZombieUrl]) notifications[nid] = op[kZombie];
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

export function removeNotification(nid) {
  if (!notifications[nid]) return;
  delete notifications[nid];
  if (__.MV3) flushSession(kNotifications, notifications);
  return browser.notifications.clear(nid);
}
