import { getUniqId } from '#/common';
import { assign, noop, Promise } from '../utils/helpers';

const handlers = {};
const callbacks = {};
const bridge = {
  callbacks,
  load: noop,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle({ cmd, data }) {
    handlers[cmd]?.(data);
  },
  send(cmd, data) {
    return new Promise(resolve => {
      postWithCallback(cmd, data, resolve);
    });
  },
  sendSync(cmd, data) {
    let res;
    postWithCallback(cmd, data, payload => { res = payload; });
    return res;
  },
};

function postWithCallback(cmd, data, cb) {
  const id = getUniqId();
  callbacks[id] = (payload) => {
    delete callbacks[id];
    cb(payload);
  };
  bridge.post(cmd, { callbackId: id, payload: data });
}

export default bridge;
