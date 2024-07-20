import bridge, { addHandlers } from './bridge';
import { browser } from '../util';

addHandlers({
  async WebextSendMessage(options, realm) {
    let response;
    let ok = true;
    try {
      response = await browser.runtime.sendMessage(
        options.extId, options.message, null
      );
    }
    catch (error) {
      ok = false;
      response = error;
    }
    const data = { ok, response };
    bridge.post('Callback', { id: options.cbId, data }, realm);
  },
});
