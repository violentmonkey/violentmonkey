import bridge from './bridge';

let lastId = 0;
const notifications = {};

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

export function onNotificationClicked(id) {
  const options = notifications[id];
  if (options) {
    const { onclick } = options;
    if (onclick) onclick();
  }
}

export function onNotificationClosed(id) {
  const options = notifications[id];
  if (options) {
    delete notifications[id];
    const { ondone } = options;
    if (ondone) ondone();
  }
}
