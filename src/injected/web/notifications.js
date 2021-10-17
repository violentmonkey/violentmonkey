import bridge from './bridge';

let lastId = 0;
const notifications = {};

bridge.addHandlers({
  __proto__: null, // Object.create(null) may be spoofed
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

export function onNotificationCreate(options) {
  lastId += 1;
  notifications[lastId] = options;
  bridge.post('Notification', {
    id: lastId,
    text: options.text,
    title: options.title,
    image: options.image,
  });
  return lastId;
}
