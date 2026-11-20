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
/** Required in FF to circumvent CSP style-src https://bugzil.la/1706787 */
const setTextContent = describeProperty(Node[PROTO], kTextContent).set;
/** Not using .test() because it internally calls .exec() per the spec */
const regexpExec = RegExp[PROTO].exec;
/** Immunize against proto poisoning by userscripts in "content" */
const nonAsciiRe = setPrototypeOf(/[\x80-\xFF]/, null);
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
 * @param {?boolean} [isBlob] truthy: blob URL, `false`: data URI, falsy: decoded text
 * @return {string}
 */
export const decodeResource = (raw, isBlob) => {
  const pos = raw::stringIndexOf(',');
  const isData = pos > 0 && raw::slice(0, 5)::toLowerCase() === 'data:';
  const mimeType = pos < 0 ? '' : raw::slice(isData ? 5/*data:*/ : 0, pos);
  const mimeData = pos < 0 ? raw : raw::slice(pos + 1);
  if (isBlob === false) {
    return isData ? raw : `data:${mimeType};base64,${mimeData}`;
  }
  const isBase64 = !isData || mimeType && mimeType::toLowerCase()::stringIndexOf('base64') >= 0;
  let bytes, str;
  if (isBase64 && U8_fromBase64) {
    bytes = U8_fromBase64(mimeData);
  } else {
    str = (isBase64 ? safeAtob : safeUnescape)(mimeData);
    bytes = nonAsciiRe::regexpExec(str) && stringToBytes(str);
  }
  return isBlob ? createObjectURL(makeSafeBlob(bytes || str, mimeType)) :
    bytes ? new SafeTextDecoder()::tdDecode(bytes) :
      str;
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
