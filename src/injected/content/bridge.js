import { browser } from '../util';
import { sendCmd } from './util';

const handlers = createNullObj();
const bgHandlers = createNullObj();
/** @type {function(VMInjection)[]} */
export const onScripts = [];
const addHandlersImpl = (dest, src, force) => {
  if (force || bridge[INJECT_INTO]) { // eslint-disable-line no-use-before-define
    assign(dest, src);
  } else {
    onScripts.push(() => assign(dest, src));
  }
};
/**
 * Without `force` handlers will be added only when userscripts are about to be injected.
 * { CommandName: true } will relay the request via sendCmd as is.
 * @param {Object.<string, MessageFromGuestHandler>} obj
 * @param {boolean} [force]
 */
export const addHandlers = addHandlersImpl.bind({}, handlers);
export const addBackgroundHandlers = addHandlersImpl.bind({}, bgHandlers);

/**
 * @property {VMBridgePostFunc} post
 * @property {VMScriptInjectInto} injectInto
 */
const bridge = {
  __proto__: null,
  /** @type {VMBridgeContentIds} */
  [IDS]: createNullObj(),
  cache: createNullObj(),
  pathMaps: createNullObj(),
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
        : node::handle(data, realm || PAGE);
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
  try {
    const fn = bgHandlers[cmd];
    if (fn) await fn(data, src); // awaiting to let the sender know when we're done
  } catch (err) {
    logging.error(err); // printing here in the tab
  }
});

/**
 * @callback MessageFromGuestHandler
 * @param {Object} [data]
 * @param {CONTENT | PAGE} realm -
 *   CONTENT when the message is from the content script context,
 *   PAGE otherwise. Make sure to specify the same realm when messaging
 *   the results back otherwise it won't reach the target script.
 */
