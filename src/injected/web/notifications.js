import bridge from './bridge';

let lastId = 0;
const notifications = {};

bridge.addHandlers({
  NotificationClicked(id) {
    const options = notifications[id];
    if (options) {
      const { onclick } = options;
      if (onclick) onclick();
    }
  },
  NotificationClosed(id) {
    const options = notifications[id];
    if (options) {
      delete notifications[id];
      const { ondone } = options;
      if (ondone) ondone();
    }
  },
});

export function onNotificationCreate(options) {
  lastId += 1;
  notifications[lastId] = options;
  bridge.post({
    cmd: 'Notification',
    data: {
      id: lastId,
      text: options.text,
      title: options.title,
      image: options.image,
    },
  });
}
