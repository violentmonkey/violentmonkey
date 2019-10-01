import { sendMessage } from '../utils';
import bridge from './bridge';

const notifications = {};

export function onNotificationCreate(options, realm) {
  sendMessage({ cmd: 'Notification', data: options })
  .then((nid) => { notifications[nid] = { id: options.id, realm }; });
}

export function onNotificationClick(nid) {
  const { id, realm } = notifications[nid] || {};
  if (id) bridge.post({ cmd: 'NotificationClicked', data: id, realm });
}

export function onNotificationClose(nid) {
  const { id, realm } = notifications[nid] || {};
  if (id) {
    bridge.post({ cmd: 'NotificationClosed', data: id, realm });
    delete notifications[nid];
  }
}
