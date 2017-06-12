import bridge from './bridge';

let lastId = 0;
const tabs = {};

export function onTabCreate(data) {
  lastId += 1;
  const key = lastId;
  const item = {
    onclose: null,
    closed: false,
    close() {
      bridge.post({ cmd: 'TabClose', data: key });
    },
  };
  tabs[key] = item;
  bridge.post({ cmd: 'TabOpen', data: { key, data } });
  return item;
}

export function onTabClosed(key) {
  const item = tabs[key];
  if (item) {
    item.closed = true;
    const { onclose } = item;
    if (onclose) onclose();
    delete tabs[key];
  }
}
