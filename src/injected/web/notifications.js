import bridge from './bridge';

let lastId = 0;
const notifications = {};

bridge.addHandlers({
  NotificationClicked(id) {
    notifications[id]?.onclick?.();
  },
  NotificationClosed(id) {
    const options = notifications[id];
    if (options) {
      delete notifications[id];
      options.ondone?.();
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
