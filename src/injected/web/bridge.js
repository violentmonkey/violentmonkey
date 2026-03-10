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
    postWithCallback(cmd, data, node, cb, true);
    return res;
  },
  /** @return {?} synchronous */
  call: postWithCallback,
};


function postWithCallback(cmd, data, node, cb, isPromise) {
  let res, err;
  const id = safeGetUniqId();
  callbacks[id] = [
    cb || ((a, b) => { res = a; err = b; }),
    !isPromise && new SafeError().stack, // Promise already tracks the caller
  ];
  bridge.post(cmd, { [CALLBACK_ID]: id, data }, node);
  if (!cb) {
    if (err) throw err;
    return res;
  }
}

export default bridge;
