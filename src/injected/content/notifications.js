import * as bridge from './bridge';
import { sendCmd } from './util';

const notifications = createNullObj();
const relay = (msg, n) => n && bridge.post(msg, n.id, n.realm) && n;

bridge.addHandlers({
  async Notification(options, realm) {
    if (bridge.reify) await bridge.reify;
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
  NotificationClick(nid) {
    relay('NotificationClicked', notifications[nid]);
  },
  NotificationClose(nid) {
    if (relay('NotificationClosed', notifications[nid])) {
      delete notifications[nid];
    }
  },
});
