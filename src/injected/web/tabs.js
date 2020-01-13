import bridge from './bridge';

let lastId = 0;
const tabs = {};

bridge.addHandlers({
  TabClosed(key) {
    const item = tabs[key];
    if (item) {
      item.closed = true;
      item.onclose?.();
      delete tabs[key];
    }
  },
});

export function onTabCreate(data) {
  lastId += 1;
  const key = lastId;
  const item = {
    onclose: null,
    closed: false,
    close() {
      bridge.post('TabClose', key);
    },
  };
  tabs[key] = item;
  bridge.post('TabOpen', { key, data });
  return item;
}
