import { CALLBACK_ID, createNullObj, getUniqIdSafe } from '../util';

const handlers = createNullObj();
const callbacks = createNullObj();
/**
 * @property {UAInjected} ua
 */
const bridge = {
  __proto__: null,
  cache: createNullObj(),
  callbacks,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle({ cmd, data, node }) {
    const fn = handlers[cmd];
    if (fn) node::fn(data);
  },
  send(cmd, data, context, node) {
    return new PromiseSafe(resolve => {
      const id = getUniqIdSafe();
      callbacks[id] = resolve;
      bridge.post(cmd, { [CALLBACK_ID]: id, data }, context, node);
    });
  },
};

export default bridge;
