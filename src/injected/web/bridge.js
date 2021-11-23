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
    return new SafePromise(resolve => {
      postWithCallback(cmd, data, context, node, resolve);
    });
  },
  syncCall: postWithCallback,
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
