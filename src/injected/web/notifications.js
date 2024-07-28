import bridge, { addHandlers } from './bridge';

const notifications = createNullObj();
addHandlers({
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

/** @this {GMContext} */
export function createNotification(text, title, image, onclick) {
  let options;
  let tag;
  if (isObject(text)) {
    options = nullObjFrom(text);
    text = options.text;
    tag = options.tag;
  } else {
    options = createNullObj();
    options.text = text;
    options.title = title;
    options.image = image;
    options.onclick = onclick;
  }
  if (!text) throw new SafeError('Notification `text` is required!');
  const id = `${this.id}:${options.tag = tag ?? safeGetUniqId()}`;
  const msg = createNullObj();
  for (const k in options) {
    msg[k] = isFunction(options[k]) ? true : options[k];
  }
  msg.id = id;
  notifications[id] = options;
  bridge.post('Notification', msg);
  return {
    remove: () => bridge.promise('RemoveNotification', id),
  };
}
