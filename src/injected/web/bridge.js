import { addErrorStack } from '../util';

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
  call: postWithCallback,
};

/**
 * @param {string} cmd
 * @param {any} data
 * @param {Node} [node]
 * @param {(this: Node, res: any, err?: Error) => any} [cb] - callback
 * @param {boolean} [cbAsync] - to keep the original callstack in the async error provided to `cb`,
 *                              note that Promise already tracks the caller in modern browsers.
 * @return {any} the result in synchronous mode (no `cb`)
 */
function postWithCallback(cmd, data, node, cb, cbAsync) {
  let res, err;
  const id = safeGetUniqId();
  callbacks[id] = [
    cb || ((a, b) => { res = a; err = b; }),
    cbAsync && new SafeError(),
  ];
  bridge.post(cmd, { [CALLBACK_ID]: id, data }, node);
  if (!cb) {
    if (err) throw addErrorStack(err, new SafeError());
    return res;
  }
}

export default bridge;
