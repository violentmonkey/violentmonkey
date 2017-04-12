import { sendMessage } from './utils';
import bridge from './content';

const tabs = {};
const tabIdMap = {};

export function tabOpen({ data, key }) {
  sendMessage({ cmd: 'TabOpen', data })
  .then(({ id }) => {
    tabs[key] = { id };
    tabIdMap[id] = key;
  });
}
export function tabClose(key) {
  let data;
  if (key) {
    const item = tabs[key];
    data = item && { id: item.id };
  } else {
    data = {};
  }
  if (data) sendMessage({ cmd: 'TabClose', data });
}
export function tabClosed(id) {
  const key = tabIdMap[id];
  if (key) {
    delete tabIdMap[id];
    delete tabs[key];
    bridge.post({ cmd: 'TabClosed', data: key });
  }
}
