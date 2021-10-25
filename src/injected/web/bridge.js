import { getUniqId } from '#/common';

const handlers = createNullObj();
const callbacks = createNullObj();
const bridge = {
  __proto__: null, // Object.create(null) may be spoofed
  cache: createNullObj(),
  callbacks,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle({ cmd, data }) {
    const fn = handlers[cmd];
    if (fn) fn(data);
  },
  send(cmd, data, context) {
    return new Promise(resolve => {
      postWithCallback(cmd, data, context, resolve);
    });
  },
  sendSync(cmd, data, context) {
    let res;
    postWithCallback(cmd, data, context, payload => { res = payload; });
    return res;
  },
};

function postWithCallback(cmd, data, context, cb) {
  const id = getUniqId();
  callbacks[id] = (payload) => {
    delete callbacks[id];
    cb(payload);
  };
  bridge.post(cmd, { callbackId: id, payload: data }, context);
}

export default bridge;
