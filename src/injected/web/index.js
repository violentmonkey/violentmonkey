import { INJECT_PAGE, INJECT_CONTENT } from '#/common/consts';
import { bindEvents } from '../utils';
import bridge from './bridge';
import store from './store';
import './gm-values';
import './gm-wrapper';
import './load-scripts';
import './notifications';
import './requests';
import './tabs';

// Make sure to call safe::methods() in code that may run after userscripts

export default function initialize(
  webId,
  contentId,
  invokeHost,
) {
  let invokeGuest;
  if (invokeHost) {
    bridge.mode = INJECT_CONTENT;
    bridge.post = (cmd, data) => invokeHost({ cmd, data }, INJECT_CONTENT);
    invokeGuest = bridge.onHandle;
    global.chrome = undefined;
    global.browser = undefined;
  } else {
    bridge.mode = INJECT_PAGE;
    bridge.post = bindEvents(webId, contentId, bridge.onHandle);
    bridge.addHandlers({
      Ping() {
        bridge.post('Pong');
      },
    });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    store.state = 1;
    // Load scripts after being handled by listeners in web page
    await 0;
    bridge.load();
  }, { once: true });
  return invokeGuest;
}

bridge.addHandlers({
  Command(data) {
    store.commands[data]?.();
  },
  Callback({ callbackId, payload }) {
    store.callbacks[callbackId]?.(payload);
  },
});
