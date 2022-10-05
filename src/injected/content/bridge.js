import { INJECT_PAGE, browser } from '../util';
import { sendCmd } from './util';

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
/**
 * @property {VMBridgePostFunc} post
 */
const bridge = {
  __proto__: null,
  ids: [], // all ids including the disabled ones for SetPopup
  runningIds: [],
  // userscripts running in the content script context are messaged via invokeGuest
  /** @type {Number[]} */
  invokableIds: [],
  failedIds: [],
  cache: createNullObj(),
  pathMaps: createNullObj(),
  /** @type {function(VMInjection)[]} */
  onScripts,
  /**
   * Without `force` handlers will be added only when userscripts are about to be injected.
   * @param {Object.<string, MessageFromGuestHandler>} obj
   * @param {boolean} [force]
   */
  addHandlers(obj, force) {
    assignHandlers(handlers, obj, force);
  },
  /** { CommandName: true } will relay the request via sendCmd as is.
   * Without `force` handlers will be added only when userscripts are about to be injected. */
  addBackgroundHandlers(obj, force) {
    assignHandlers(bgHandlers, obj, force);
  },
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data, node }, realm) {
    const handle = handlers[cmd];
    let callbackId = data && getOwnProp(data, CALLBACK_ID);
    if (callbackId) {
      data = data.data;
    }
    let res;
    try {
      res = handle === true
        ? sendCmd(cmd, data)
        : node::handle(data, realm || INJECT_PAGE);
      if (isPromise(res)) {
        res = await res;
      }
    } catch (e) {
      callbackId = 'Error';
      res = e;
    }
    if (callbackId) {
      bridge.post('Callback', { id: callbackId, data: res }, realm);
    }
  },
};

export default bridge;

browser.runtime.onMessage.addListener(async ({ cmd, data }, src) => {
  const fn = bgHandlers[cmd];
  if (fn) await fn(data, src); // awaiting to let the sender know when we're done
});

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {INJECT_CONTENT | INJECT_PAGE} realm -
 *   INJECT_CONTENT when the message is from the content script context,
 *   INJECT_PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
