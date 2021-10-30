import bridge from './bridge';
import { createNullObj } from '../util';

let lastId = 0;
const notifications = createNullObj();

bridge.addHandlers({
  NotificationClicked(id) {
    const fn = notifications[id]?.onclick;
    if (fn) fn();
  },
  NotificationClosed(id) {
    const options = notifications[id];
    if (options) {
      delete notifications[id];
      const fn = options.ondone;
      if (fn) fn();
    }
  },
});

export function onNotificationCreate(options, context) {
  lastId += 1;
  notifications[lastId] = options;
  bridge.post('Notification', {
    id: lastId,
    text: options.text,
    title: options.title,
    image: options.image,
  }, context);
  return lastId;
}
