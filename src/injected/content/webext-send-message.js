import { addHandlers } from './bridge';
import { browser } from '../util';

addHandlers({
  WebextSendMessage(options) {
      browser.runtime.sendMessage(options.id, options.message, null);
  },
});
