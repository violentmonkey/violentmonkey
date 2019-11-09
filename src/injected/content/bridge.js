import { sendMessage } from '#/common';
import { INJECT_PAGE, browser } from '#/common/consts';
import { assign } from '../utils/helpers';

/** @type {Object.<string, MessageFromGuestHandler>} */
const handlers = {};
const bgHandlers = {};

export default {
  ids: [],
  enabledIds: [],
  // userscripts running in the content script context are messaged via invokeGuest
  invokableIds: [],
  // {CommandName: sendMessage} will relay the request via sendMessage as is
  addHandlers(obj) {
    assign(handlers, obj);
  },
  addBackgroundHandlers(obj) {
    assign(bgHandlers, obj);
  },
  // realm is provided when called directly via invokeHost
  onHandle(req, realm) {
    const handle = handlers[req.cmd];
    if (handle === sendMessage) sendMessage(req);
    else if (handle) handle(req.data, realm || INJECT_PAGE);
  },
};

browser.runtime.onMessage.addListener((req, src) => {
  const handle = bgHandlers[req.cmd];
  if (handle) handle(req.data, src);
});

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {INJECT_CONTENT | INJECT_PAGE} realm -
 *   INJECT_CONTENT when the message is from the content script context,
 *   INJECT_PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
