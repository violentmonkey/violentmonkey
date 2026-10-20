import * as bridge from './bridge';
import { sendCmd } from './util';

bridge.addHandlers({
  GetTab: (data, realm) => sendTabState('GetTab', data, realm),
  SaveTab: (data, realm) => sendTabState('SaveTab', data, realm),
  GetTabs: (data, realm) => sendTabState('GetTabs', data, realm),
});

async function sendTabState(cmd, { id, tab }, realm) {
  if (getOwnProp(bridge.ids, id) !== realm) {
    throw new SafeError('Tab state is only available to an injected script in this realm.');
  }
  if (bridge.reify) await bridge.reify;
  return sendCmd(cmd, { id, tab, __proto__: null });
}
