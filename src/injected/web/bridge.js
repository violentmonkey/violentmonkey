const handlers = createNullObj();
export const addHandlers = obj => assign(handlers, obj);
export const callbacks = createNullObj();
/**
 * @property {VMScriptGMInfoPlatform} ua
 * @property {VMBridgePostFunc} post
 * @property {VMBridgeMode} mode
 */
const bridge = {
  __proto__: null,
  onHandle({ cmd, data, node }) {
    const fn = handlers[cmd];
    if (fn) node::fn(data);
  },
  send(cmd, data, node) {
    let cb;
    let res;
    try {
      res = new UnsafePromise(resolve => {
        cb = resolve;
      });
    } catch (e) {
      // Unavoidable since vault's Promise can't be used after the iframe is removed
    }
    postWithCallback(cmd, data, node, cb);
    return res;
  },
  call: postWithCallback,
};

let callbackResult;

function postWithCallback(cmd, data, node, cb, customCallbackId) {
  const id = safeGetUniqId();
  callbacks[id] = cb || defaultCallback;
  if (customCallbackId) {
    setOwnProp(data, customCallbackId, id);
  } else {
    data = { [CALLBACK_ID]: id, data };
  }
  bridge.post(cmd, data, node);
  if (!cb) return callbackResult;
}

function defaultCallback(val) {
  callbackResult = val;
}

export default bridge;
