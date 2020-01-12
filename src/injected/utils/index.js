import { addEventListener } from './helpers';

export { getUniqId } from '#/common';
export { sendCmd, sendMessage, cache2blobUrl } from '#/common';

const { CustomEvent } = global;
const { dispatchEvent } = EventTarget.prototype;

export function bindEvents(srcId, destId, handle, cloneInto) {
  document::addEventListener(srcId, e => handle(e.detail));
  const pageContext = cloneInto && document.defaultView;
  return data => {
    const detail = cloneInto ? cloneInto(data, pageContext) : data;
    const e = new CustomEvent(destId, { detail });
    document::dispatchEvent(e);
  };
}

// it's injected as a string so only the page functions can be used
export function attachFunction(id, cb) {
  Object.defineProperty(window, id, {
    value(...args) {
      cb.apply(this, args);
      delete window[id];
    },
    configurable: true,
  });
}
