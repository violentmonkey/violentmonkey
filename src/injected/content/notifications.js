import { sendCmd } from '#/common';
import { objectEntries } from '#/common/object';
import { filter } from '../utils/helpers';
import bridge from './bridge';

const notifications = {};

bridge.addHandlers({
  async Notification(options, realm) {
    const nid = await sendCmd('Notification', options);
    notifications[nid] = { id: options.id, realm };
  },
  RemoveNotification(id) {
    const nid = objectEntries(notifications)::filter(([, val]) => val.id === id)[0]?.[0];
    if (nid) {
      delete notifications[nid];
      return sendCmd('RemoveNotification', nid);
    }
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
