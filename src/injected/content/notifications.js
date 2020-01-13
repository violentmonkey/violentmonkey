import { sendCmd } from '../utils';
import bridge from './bridge';

const notifications = {};

bridge.addHandlers({
  async Notification(options, realm) {
    const nid = await sendCmd('Notification', options);
    notifications[nid] = { id: options.id, realm };
  },
});

bridge.addBackgroundHandlers({
  NotificationClick(nid) {
    const { id, realm } = notifications[nid] || {};
    if (id) bridge.post('NotificationClicked', id, realm);
  },
  NotificationClose(nid) {
    const { id, realm } = notifications[nid] || {};
    if (id) {
      bridge.post('NotificationClosed', id, realm);
      delete notifications[nid];
    }
  },
});
