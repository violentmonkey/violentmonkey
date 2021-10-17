import { sendCmd } from '#/common';
import { INJECT_PAGE, browser } from '#/common/consts';

// {CommandName: sendCmd} will relay the request via sendCmd as is
/** @type {Object.<string, MessageFromGuestHandler>} */
const handlers = createNullObj();
const bgHandlers = createNullObj();
const bridge = {
  __proto__: null, // Object.create(null) may be spoofed
  ids: [], // all ids including the disabled ones for SetPopup
  runningIds: [],
  // userscripts running in the content script context are messaged via invokeGuest
  /** @type Number[] */
  invokableIds: [],
  failedIds: [],
  // {CommandName: sendCmd} will relay the request via sendCmd as is
  addHandlers(obj) {
    assign(handlers, obj);
  },
  addBackgroundHandlers(obj) {
    assign(bgHandlers, obj);
  },
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data }, realm) {
    const handle = handlers[cmd];
    if (!handle) throw new Error(`Invalid command: ${cmd}`);
    const callbackId = data?.callbackId;
    const payload = callbackId ? data.payload : data;
    let res = handle === sendCmd ? sendCmd(cmd, payload) : handle(payload, realm || INJECT_PAGE);
    if (typeof res?.then === 'function') {
      res = await res;
    }
    if (callbackId && res !== undefined) {
      bridge.post('Callback', { callbackId, payload: res }, realm);
    }
  },
};

export default bridge;

browser.runtime.onMessage.addListener(({ cmd, data }, src) => {
  const fn = bgHandlers[cmd];
  if (fn) fn(data, src);
});

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {INJECT_CONTENT | INJECT_PAGE} realm -
 *   INJECT_CONTENT when the message is from the content script context,
 *   INJECT_PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
