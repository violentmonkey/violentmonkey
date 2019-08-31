import { getUniqId } from '#/common';
import { CustomEvent, jsonDump, jsonLoad } from './helpers';

export { getUniqId };
export {
  sendMessage, request, throttle, cache2blobUrl,
} from '#/common';

export function postData(destId, data) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const e = new CustomEvent(destId, { detail: jsonDump(data) });
  document.dispatchEvent(e);
}

export function bindEvents(srcId, destId, handle) {
  document.addEventListener(srcId, (e) => {
    const data = jsonLoad(e.detail);
    handle(data);
  }, false);
  return (data) => { postData(destId, data); };
}

export function attachFunction(id, cb) {
  Object.defineProperty(window, id, {
    value(...args) {
      cb.apply(this, args);
      delete window[id];
    },
    configurable: true,
  });
}
