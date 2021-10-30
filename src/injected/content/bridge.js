import { isPromise, sendCmd } from '#/common';
import { INJECT_PAGE, browser } from '#/common/consts';
import { CALLBACK_ID, createNullObj, getOwnProp } from '../util';

const allow = createNullObj();
/** @type {Object.<string, MessageFromGuestHandler>} */
const handlers = createNullObj();
const bgHandlers = createNullObj();
const onScripts = [];
const assignHandlers = (dest, src, force) => {
  if (force) {
    assign(dest, src);
  } else {
    onScripts.push(() => assign(dest, src));
  }
};
const bridge = {
  __proto__: null,
  ids: [], // all ids including the disabled ones for SetPopup
  runningIds: [],
  // userscripts running in the content script context are messaged via invokeGuest
  /** @type Number[] */
  invokableIds: [],
  failedIds: [],
  onScripts,
  /** Without `force` handlers will be added only when userscripts are about to be injected. */
  addHandlers(obj, force) {
    assignHandlers(handlers, obj, force);
  },
  /** { CommandName: true } will relay the request via sendCmd as is.
   * Without `force` handlers will be added only when userscripts are about to be injected. */
  addBackgroundHandlers(obj, force) {
    assignHandlers(bgHandlers, obj, force);
  },
  allow(cmd, dataKey) {
    (allow[cmd] || (allow[cmd] = createNullObj()))[dataKey] = true;
  },
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data, dataKey, node }, realm) {
    const handle = handlers[cmd];
    if (!handle || !allow[cmd]?.[dataKey]) {
      throw new ErrorSafe(`[Violentmonkey] Invalid command: "${cmd}" on ${global.location.host}`);
    }
    const callbackId = data && data::getOwnProp(CALLBACK_ID);
    if (callbackId) {
      data = data.data;
    }
    let res = handle === true
      ? sendCmd(cmd, data)
      : node::handle(data, realm || INJECT_PAGE);
    if (res && isPromise(res)) {
      res = await res;
    }
    if (callbackId) {
      bridge.post('Callback', { id: callbackId, data: res }, realm);
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
