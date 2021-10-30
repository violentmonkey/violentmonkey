export const NS_HTML = 'http://www.w3.org/1999/xhtml';
export const CALLBACK_ID = '__CBID';

/** Using __proto__ because Object.create(null) may be spoofed */
export const createNullObj = () => ({ __proto__: null });
export const promiseResolve = () => (async () => {})();
export const getOwnProp = (obj, key) => (
  obj::hasOwnProperty(key)
    ? obj[key]
    : undefined
);

export const bindEvents = (srcId, destId, bridge, cloneInto) => {
  /* Using a separate event for `node` because CustomEvent can't transfer nodes,
   * whereas MouseEvent (and some others) can't transfer objects without stringification. */
  let incomingNodeEvent;
  window::on(srcId, e => {
    if (!incomingNodeEvent) {
      // CustomEvent is the main message
      const data = e::getDetail();
      incomingNodeEvent = data.node && data;
      if (!incomingNodeEvent) bridge.onHandle(data);
    } else {
      // MouseEvent is the second event when the main event has `node: true`
      incomingNodeEvent.node = e::getRelatedTarget();
      bridge.onHandle(incomingNodeEvent);
      incomingNodeEvent = null;
    }
  });
  bridge.post = (cmd, data, { dataKey } = bridge, node) => {
    // Constructing the event now so we don't send anything if it throws on invalid `node`
    const evtNode = node && new MouseEventSafe(destId, { relatedTarget: node });
    const msg = { cmd, data, dataKey, node: !!evtNode };
    const detail = cloneInto ? cloneInto(msg, document) : msg;
    const evtMain = new CustomEventSafe(destId, { detail });
    window::fire(evtMain);
    if (evtNode) window::fire(evtNode);
  };
};

/** args is [tags?, ...rest] */
export const log = (level, ...args) => {
  let s = '[Violentmonkey]';
  if (args[0]) args[0]::forEach(tag => { s += `[${tag}]`; });
  args[0] = s;
  logging[level]::apply(logging, args);
};

/** Workaround for array eavesdropping via prototype setters like '0','1',...
 * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
 * its length or from an unassigned `hole`. */
export function safePush(value) {
  defineProperty(this, this.length, { value, writable: true, configurable: true });
}

/**
 * Picks into `this`
 * @param {Object} obj
 * @param {string[]} keys
 * @returns {Object} same object as `this`
 */
export function pickIntoThis(obj, keys) {
  if (obj) {
    keys::forEach(key => {
      if (obj::hasOwnProperty(key)) {
        this[key] = obj[key];
      }
    });
  }
  return this;
}
