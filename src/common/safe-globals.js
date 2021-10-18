/* eslint-disable no-unused-vars */

const globalThis = (function _() { return this || {}; }());
// Not exporting the built-in globals because this also runs in node
const {
  Array, Boolean, Object, Promise, Uint8Array,
  addEventListener, removeEventListener,
  /* per spec `document` can change only in about:blank but we don't inject there
     https://html.spec.whatwg.org/multipage/window-object.html#dom-document-dev */
  document,
  window,
} = globalThis;
export const { hasOwnProperty } = {};
export const safeCall = hasOwnProperty.call.bind(hasOwnProperty.call);
