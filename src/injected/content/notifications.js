import { sendMessage } from '../utils';
import bridge from './bridge';

const notifications = {};

bridge.addHandlers({
  Notification(options, realm) {
    sendMessage({ cmd: 'Notification', data: options })
    .then((nid) => { notifications[nid] = { id: options.id, realm }; });
  },
});

bridge.addBackgroundHandlers({
  NotificationClick(nid) {
    const { id, realm } = notifications[nid] || {};
    if (id) bridge.post({ cmd: 'NotificationClicked', data: id, realm });
  },
  NotificationClose(nid) {
    const { id, realm } = notifications[nid] || {};
    if (id) {
      bridge.post({ cmd: 'NotificationClosed', data: id, realm });
      delete notifications[nid];
    }
  },
});
