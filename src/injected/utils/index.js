import { getUniqId } from '#/common';
import { jsonDump, jsonLoad, addEventListener } from './helpers';

export { getUniqId, jsonDump };
export {
  sendMessage, request, throttle, cache2blobUrl,
} from '#/common';

const { CustomEvent } = global;
const { dispatchEvent } = EventTarget.prototype;

export function postData(destId, data, asString) {
  // Firefox issue: data must be stringified to avoid cross-origin problem
  const detail = asString ? jsonDump(data) : data;
  const e = new CustomEvent(destId, { detail });
  document::dispatchEvent(e);
}

/** @returns {PostDataFunction} */
export function bindEvents(srcId, destId, handle) {
  document::addEventListener(srcId, ({ detail }) => {
    // we use bridge.post() to send an object with cmd and data, never a literal string,
    // so |detail| being a string means it was sent from another context/realm (Firefox only)
    const data = typeof detail === 'string' ? jsonLoad(detail) : detail;
    handle(data);
  });
  // let post.asString be configurable by the calling code
  const post = data => postData(destId, data, post.asString);
  return post;
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

/**
 * @typedef {Function} PostDataFunction
 * @property {boolean} asString -
 *   true = stringify data sent via CustomEvent,
 *   required in Firefox when sending between realms
 *   (page context vs content script context)
 */
