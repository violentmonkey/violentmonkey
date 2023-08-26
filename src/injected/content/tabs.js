import bridge, { addBackgroundHandlers, addHandlers } from './bridge';
import { sendCmd } from './util';

const tabIds = createNullObj();
const tabKeys = createNullObj();
const realms = createNullObj();

addHandlers({
  async TabOpen({ key, data }, realm) {
    await bridge[REIFY];
    const { id } = await sendCmd('TabOpen', data);
    tabIds[key] = id;
    tabKeys[id] = key;
    realms[id] = realm;
  },
  async TabClose(key) {
    await bridge[REIFY];
    const id = tabIds[key];
    // !key => close current tab
    // id => close tab by id
    if (!key || id) sendCmd('TabClose', { id });
  },
});

addBackgroundHandlers({
  TabClosed(id) {
    const key = tabKeys[id];
    const realm = realms[id];
    delete realms[id];
    delete tabKeys[id];
    delete tabIds[key];
    if (key) bridge.post('TabClosed', key, realm);
  },
});
