export const clientCommands = {__proto__: null};
/** @type {Map<number, PromiseWithResolvers & { stack: string }>} */
const pending = /*@__PURE__*/new Map();
const swContainer = __.SW_CLIENT && navigator.serviceWorker;
const getController = async () => (swController = (await swContainer.ready).active);

let swController = __.SW_CLIENT && swContainer.controller;
let curId = 0;

export async function sendCmdToSW(cmd, data, fakeSrc) {
  return sendCmdTo(cmd, data, swController || await getController(), fakeSrc);
}

/**
 * @param {string} cmd
 * @param {any} data
 * @param {ServiceWorker | WindowClient} target
 * @param {{}} [fakeSrc]
 * @return {Promise}
 */
export function sendCmdTo(cmd, data, target, fakeSrc) {
  const p = Promise.withResolvers();
  if (__.DEBUG) {
    console.log('%cOUT', 'color:#008', location.pathname, ...arguments);
    p.cmd = cmd;
    p.data = data;
    p.fakeSrc = fakeSrc;
  }
  p.stack = new Error('Local').stack;
  pending.set(++curId, p);
  target.postMessage({
    id: curId,
    msg: { cmd, data },
    src: fakeSrc,
  });
  return p.promise;
}

/**
 * @param {function} handler
 * @param {MessageEvent} event
 * @return {Promise<void>}
 */
export async function onClientMessage(handler, { data, source }) {
  const { id, msg } = data;
  if (__.DEBUG) console.log('%cIN', 'color:#068', location.pathname, data, pending.get(id));
  let p, res, err;
  if (msg) {
    try {
      res = handler(msg, data.src);
      if (res instanceof Promise)
        res = await res;
    } catch (e) {
      err = e;
      res = undefined; // clearing Promise
    }
    source.postMessage({ id, res, err });
  } else if ((p = pending.get(id))) {
    pending.delete(id);
    if ((err = data.err)) {
      err.stack += '\n' + p.stack;
      p.reject(err);
    } else {
      p.resolve(data.res);
    }
  } else if (__.DEV) {
    console.error('Orphaned message', data);
  }
}

export function rejectPending(msg) {
  for (const p of pending.values()) {
    const err = new Error(msg);
    err.stack = p.stack;
    p.reject(err);
  }
  pending.clear();
}

if (__.SW_CLIENT) {
  // Receiver for a response from handleCommandMessage -> sw.onmessage
  swContainer.onmessage = onClientMessage.bind(null, ({cmd, data}, src) => (
    clientCommands[cmd](data, src)
  ));
}
