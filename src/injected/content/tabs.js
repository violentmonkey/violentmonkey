import { getFullUrl } from 'src/common';
import { sendMessage } from '../utils';
import bridge from './bridge';

const tabIds = {};
const tabKeys = {};

export function tabOpen({ key, data }) {
  data.url = getFullUrl(data.url, window.location.href);
  sendMessage({ cmd: 'TabOpen', data })
  .then(({ id }) => {
    tabIds[key] = id;
    tabKeys[id] = key;
  });
}

export function tabClose(key) {
  const id = tabIds[key];
  sendMessage({ cmd: 'TabClose', data: { id } });
}

export function tabClosed(id) {
  const key = tabKeys[id];
  delete tabKeys[id];
  delete tabIds[key];
  if (key) {
    bridge.post({ cmd: 'TabClosed', data: key });
  }
}
