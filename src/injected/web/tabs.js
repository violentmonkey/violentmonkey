import bridge from './bridge';
import { createNullObj } from '../util';

let lastId = 0;
const tabs = createNullObj();

bridge.addHandlers({
  TabClosed(key) {
    const item = tabs[key];
    if (item) {
      item.closed = true;
      delete tabs[key];
      const fn = item.onclose;
      if (fn) fn();
    }
  },
});

export function onTabCreate(data, context) {
  lastId += 1;
  const key = lastId;
  const item = {
    onclose: null,
    closed: false,
    close() {
      bridge.post('TabClose', key, context);
    },
  };
  tabs[key] = item;
  bridge.post('TabOpen', { key, data }, context);
  return item;
}
