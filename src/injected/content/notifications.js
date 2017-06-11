import { sendMessage } from '../utils';
import bridge from './bridge';

const notifications = {};

export function onNotificationCreate(options) {
  sendMessage({ cmd: 'Notification', data: options })
  .then(nid => { notifications[nid] = options.id; });
}

export function onNotificationClick(nid) {
  const id = notifications[nid];
  if (id) bridge.post({ cmd: 'NotificationClicked', data: id });
}

export function onNotificationClose(nid) {
  const id = notifications[nid];
  if (id) {
    bridge.post({ cmd: 'NotificationClosed', data: id });
    delete notifications[nid];
  }
}
