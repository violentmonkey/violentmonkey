const handlers = createNullObj();
const callbacks = createNullObj();
/**
 * @property {UAInjected} ua
 */
const bridge = {
  __proto__: null,
  callbacks,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle({ cmd, data, node }) {
    const fn = handlers[cmd];
    if (fn) node::fn(data);
  },
  send(cmd, data, context, node) {
    let cb;
    let res;
    try {
      res = new UnsafePromise(resolve => {
        cb = resolve;
      });
    } catch (e) {
      // Unavoidable since vault's Promise can't be used after the iframe is removed
    }
    postWithCallback(cmd, data, context, node, cb);
    return res;
  },
  call: postWithCallback,
};

function postWithCallback(cmd, data, context, node, cb, customCallbackId) {
  const id = safeGetUniqId();
  callbacks[id] = cb;
  if (customCallbackId) {
    setOwnProp(data, customCallbackId, id);
  } else {
    data = { [CALLBACK_ID]: id, data };
  }
  bridge.post(cmd, data, context, node);
}

export default bridge;
