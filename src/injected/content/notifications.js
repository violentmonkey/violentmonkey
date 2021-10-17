import { sendCmd } from '#/common';
import bridge from './bridge';

const notifications = createNullObj();

bridge.addHandlers({
  __proto__: null, // Object.create(null) may be spoofed
  async Notification(options, realm) {
    const nid = await sendCmd('Notification', options);
    notifications[nid] = { id: options.id, realm };
  },
  RemoveNotification(id) {
    const nid = objectEntries(notifications).find(entry => entry[1].id === id)?.[0];
    if (nid) {
      delete notifications[nid];
      return sendCmd('RemoveNotification', nid);
    }
  },
});

bridge.addBackgroundHandlers({
  __proto__: null, // Object.create(null) may be spoofed
  NotificationClick(nid) {
    const n = notifications[nid];
    if (n) bridge.post('NotificationClicked', n.id, n.realm);
  },
  NotificationClose(nid) {
    const n = notifications[nid];
    if (n) {
      bridge.post('NotificationClosed', n.id, n.realm);
      delete notifications[nid];
    }
  },
});
