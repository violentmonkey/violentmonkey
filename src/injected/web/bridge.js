import { addErrorStack } from '../util';

const handlers = createNullObj();
export const addHandlers = obj => assign(handlers, obj);
export const callbacks = createNullObj();
export const commands = createNullObj();
export const displayNames = createNullObj();
export const storages = createNullObj();
/** @type {VMInjection.Info} */
export const info = createNullObj();
export const onHandle = ({ cmd, data, node }) => {
  if ((cmd = handlers[cmd])) {
    if (node) node::cmd(data);
    else cmd(data);
  }
};
/**
 * @param {string} cmd
 * @param {any} data
 * @param {EventTarget} [node]
 * @return {Promise}
 */
export const promise = (cmd, data, node) => {
  const prr = SafePromiseWithResolvers();
  call(cmd, data, node, prr.resolve);
  return prr.promise;
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
export const call = (cmd, data, node, cb, cbAsync) => {
  let res, err;
  const id = safeGetUniqId();
  callbacks[id] = [
    cb || ((a, b) => { res = a; err = b; }),
    cbAsync && new SafeError(),
  ];
  post(cmd, { [CALLBACK_ID]: id, data }, node);
  if (!cb) {
    if (err) throw addErrorStack(err, new SafeError());
    return res;
  }
};
/** @type {VMBridgeMode} */
export let mode;
/** @type {VMBridgePostFunc} */
export let post;
