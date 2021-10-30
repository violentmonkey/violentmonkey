import { sendCmd } from '#/common';
import bridge from './bridge';
import { createNullObj } from '../util';

const notifications = createNullObj();

bridge.addHandlers({
  __proto__: null,
  async Notification(options, realm) {
    const nid = await sendCmd('Notification', options);
    notifications[nid] = { id: options.id, realm };
  },
  RemoveNotification(id) {
    for (const nid in notifications) {
      if (notifications[nid].id === id) {
        delete notifications[nid];
        return sendCmd('RemoveNotification', nid);
      }
    }
  },
});

bridge.addBackgroundHandlers({
  __proto__: null,
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
