import { sendCmd } from '#/common';
import bridge from './bridge';

const tabIds = {};
const tabKeys = {};
const realms = {};

bridge.addHandlers({
  async TabOpen({ key, data }, realm) {
    const { id } = await sendCmd('TabOpen', data);
    tabIds[key] = id;
    tabKeys[id] = key;
    realms[id] = realm;
  },
  TabClose(key) {
    const id = tabIds[key];
    // !key => close current tab
    // id => close tab by id
    if (!key || id) sendCmd('TabClose', { id });
  },
});

bridge.addBackgroundHandlers({
  TabClosed(id) {
    const key = tabKeys[id];
    const realm = realms[id];
    delete realms[id];
    delete tabKeys[id];
    delete tabIds[key];
    if (key) bridge.post('TabClosed', key, realm);
  },
});
