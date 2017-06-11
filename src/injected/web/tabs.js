import bridge from './bridge';

const tabs = {};

export function onTabCreate(data) {
  const item = {
    id: null,
    onclose: null,
    closed: false,
  };
  const ready = bridge.post({ cmd: 'TabOpen', data })
  .then(({ id }) => {
    item.id = id;
    tabs[id] = item;
  });
  item.close = () => ready.then(() => {
    bridge.post({ cmd: 'TabClose', data: this.id });
  });
  return item;
}

export function onTabClosed(id) {
  const item = tabs[id];
  if (item) {
    item.closed = true;
    const { onclose } = item;
    if (onclose) onclose();
    delete tabs[id];
  }
}
