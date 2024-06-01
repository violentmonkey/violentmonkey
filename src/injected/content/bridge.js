import { browser } from '../util';
import { sendCmd } from './util';

const handlers = createNullObj();
const bgHandlers = createNullObj();
/** @type {function(VMInjection)[]} */
export const onScripts = [];
const addHandlersImpl = (dest, src, force) => {
  if (force || INJECT_INTO in bridge) { // eslint-disable-line no-use-before-define
    assign(dest, src);
  } else {
    onScripts.push(() => assign(dest, src));
  }
};
/**
 * Without `force` handlers will be added only when userscripts are about to be injected.
 * { CommandName: true } will relay the request via sendCmd as is.
 * { CommandName: REIFY } same as `true` but waits until reified when pre-rendered.
 * @callback AddHandlers
 * @param {Object.<string, MessageFromGuestHandler>} obj
 * @param {boolean} [force]
 */
/** @type {AddHandlers} */
export const addHandlers = addHandlersImpl.bind({}, handlers);
/** @type {AddHandlers} */
export const addBackgroundHandlers = addHandlersImpl.bind({}, bgHandlers);

/**
 * @property {VMBridgePostFunc} [post] - present only when the web bridge was initialized
 * @property {VMScriptInjectInto} [injectInto] - present only after GetInjected received data
 * @property {Promise<void>} [reify] - present in pre-rendered documents, resolved when it's shown
 */
const bridge = {
  __proto__: null,
  [IDS]: createNullObj(),
  cache: createNullObj(),
  pathMaps: createNullObj(),
  // realm is provided when called directly via invokeHost
  async onHandle({ cmd, data, node }, realm) {
    let res;
    let handle = handlers[cmd];
    let callbackId = data && getOwnProp(data, CALLBACK_ID);
    if (callbackId) {
      data = data.data;
    }
    try {
      if (!handle) throw data;
      if (handle === REIFY) {
        handle = true;
        res = bridge[REIFY];
        if (res) await res;
      }
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

browser.runtime.onMessage.addListener(({ cmd, data }, src) => {
  if ((cmd = bgHandlers[cmd])) {
    data = cmd(data, src);
    if (data && isPromise(data)) data::then(null, logging.error);
    return data;
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
