// eslint-disable-next-line no-restricted-imports
import { sendMessage } from '@/common';
import { U8_fromBase64 } from '../util';

export * from './util-task';

/** When looking for documentElement, use '*' to also support XML pages
 * Note that we avoid spoofed prototype getters by using hasOwnProperty, and not using `length`
 * as it searches for ALL matching nodes when this tag wasn't cached internally. */
export const elemByTag = (tag, i) => getOwnProp(document::getElementsByTagName(tag), i || 0);
const {
  TextDecoder: SafeTextDecoder,
  unescape: safeUnescape,
} = global;
const { createElementNS } = document;
const tdDecode = SafeTextDecoder[PROTO].decode;
const kTextContent = 'textContent';
// required in FF to circumvent CSP style-src https://bugzil.la/1706787
const setTextContent = describeProperty(Node[PROTO], kTextContent).set;
const regexpTest = RegExp[PROTO].test; // Deeply unsafe. TODO: remove.
export const { createObjectURL, revokeObjectURL } = URL;

/**
 * @param {string} tag
 * @param {function} cb - callback runs immediately, unlike a chained then()
 * @param {?} [arg]
 * @returns {Promise<void>}
 */
export const onElement = (tag, cb, arg) => new SafePromise(resolve => {
  if (elemByTag(tag)) {
    resolve(cb(arg));
  } else {
    const observer = new MutationObserver(() => {
      if (elemByTag(tag)) {
        observer.disconnect();
        resolve(cb(arg));
      }
    });
    // documentElement may be replaced so we'll observe the entire document
    observer.observe(document, { childList: true, subtree: true });
  }
});

export const makeElem = (tag, attrs) => {
  const el = document::createElementNS('http://www.w3.org/1999/xhtml', tag);
  if (attrs && isString(attrs)) {
    el::setTextContent(attrs);
  } else if (attrs) {
    objectKeys(attrs)::forEach(key => {
      if (key === kTextContent) el::setTextContent(attrs[key]);
      else el::setAttribute(key, attrs[key]);
    });
  }
  return el;
};

export const makeSafeBlob = (data, type) => new SafeBlob([data], { __proto__: null, type });

const stringToBytes = str => {
  const len = str.length;
  const bytes = new SafeUint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = safeCharCodeAt(str, i);
  }
  return bytes;
};

/**
 * @param {string} raw
 * @param {true | false | typeof Blob | typeof Uint8Array } [isBlob]
 * @return {string|Uint8Array|Blob|string}
 */
export const decodeResource = (raw, isBlob) => {
  let res;
  const pos = raw::stringIndexOf(',');
  const isData = pos > 0 && raw::slice(0, 5)::toLowerCase() === 'data:';
  const mimeType = pos < 0 ? '' : raw::slice(isData ? 5/*data:*/ : 0, pos);
  const mimeData = pos < 0 ? raw : raw::slice(pos + 1);
  const isBase64 = !isData || mimeType && mimeType::toLowerCase()::stringIndexOf('base64') >= 0;
  if (isBlob === false) {
    return isData ? raw : `data:${mimeType};base64,${mimeData}`;
  }
  res = !isBase64 ? safeUnescape(mimeData) :
    U8_fromBase64 ? U8_fromBase64(mimeData) :
      safeAtob(mimeData);
  if (isBase64 && U8_fromBase64
  // TODO: do the check in BG to avoid RegExp's internal access to unsafe props on itself & res?
  || /[\x80-\xFF]/::regexpTest(res) && (res = stringToBytes(res))) {
    if (!isBlob) res = new SafeTextDecoder()::tdDecode(res);
  }
  if (isBlob && isBlob !== SafeUint8Array) {
    res = makeSafeBlob(res, mimeType);
    if (isBlob !== SafeBlob) res = createObjectURL(res);
  }
  return res;
};

/**
 * Used by `injected`
 * @param {string} cmd
 * @param data
 * @param {{retry?: boolean}} [options]
 * @return {Promise}
 */
export const sendCmd = (cmd, data, options) => sendMessage({
  cmd,
  data,
  url: location.href, // to replace MessageSender.url which doesn't change on soft navigation
  [kTop]: topRenderMode,
}, options);
