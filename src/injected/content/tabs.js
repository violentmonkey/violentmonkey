import { getFullUrl } from '#/common';
import { sendMessage } from '../utils';
import bridge from './bridge';

const tabIds = {};
const tabKeys = {};
const realms = {};

bridge.addHandlers({
  TabOpen({ key, data }, realm) {
    data.url = getFullUrl(data.url, window.location.href);
    sendMessage({ cmd: 'TabOpen', data })
    .then(({ id }) => {
      tabIds[key] = id;
      tabKeys[id] = key;
      realms[id] = realm;
    });
  },
  TabClose(key) {
    const id = tabIds[key];
    // !key => close current tab
    // id => close tab by id
    if (!key || id) sendMessage({ cmd: 'TabClose', data: { id } });
  },
});

bridge.addBackgroundHandlers({
  TabClosed(id) {
    const key = tabKeys[id];
    const realm = realms[id];
    delete realms[id];
    delete tabKeys[id];
    delete tabIds[key];
    if (key) {
      bridge.post({ cmd: 'TabClosed', data: key, realm });
    }
  },
});
