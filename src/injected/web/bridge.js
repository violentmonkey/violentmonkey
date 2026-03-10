const handlers = createNullObj();
export const addHandlers = obj => assign(handlers, obj);
export const callbacks = createNullObj();
export const displayNames = createNullObj();
/**
 * @mixes VMInjection.Info
 * @property {VMBridgePostFunc} post - synchronous
 * @property {VMBridgeMode} mode
 */
const bridge = {
  __proto__: null,
  onHandle({ cmd, data, node }) {
    const fn = handlers[cmd];
    if (fn) node::fn(data);
  },
  /** @return {Promise} asynchronous */
  promise(cmd, data, node) {
    let cb;
    let res;
    res = new SafePromise(resolve => {
      cb = resolve;
    });
    if (IS_FIREFOX) setPrototypeOf(res, SafePromiseConstructor);
    postWithCallback(cmd, data, node, cb);
    return res;
  },
  /** @return {?} synchronous */
  call: postWithCallback,
};


function postWithCallback(cmd, data, node, cb) {
  let res;
  const id = safeGetUniqId();
  callbacks[id] = [
    cb || (val => { res = val; }),
    !cb && new SafeError().stack,
  ];
  bridge.post(cmd, { [CALLBACK_ID]: id, data }, node);
  if (!cb) return res;
}

export default bridge;
