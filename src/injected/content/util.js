// eslint-disable-next-line no-restricted-imports
import { sendMessage } from '@/common';

export * from './util-task';

/** When looking for documentElement, use '*' to also support XML pages
 * Note that we avoid spoofed prototype getters by using hasOwnProperty, and not using `length`
 * as it searches for ALL matching nodes when this tag wasn't cached internally. */
export const elemByTag = (tag, i) => getOwnProp(document::getElementsByTagName(tag), i || 0);
const {
  TextDecoder: SafeTextDecoder,
} = global;
const { createElementNS } = document;
const tdDecode = SafeTextDecoder[PROTO].decode;
const kTextContent = 'textContent';
// required in FF to circumvent CSP style-src https://bugzil.la/1706787
const setTextContent = describeProperty(Node[PROTO], kTextContent).set;
const regexpTest = RegExp[PROTO].test; // Deeply unsafe. TODO: remove.
const { createObjectURL } = URL;

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

export const decodeResource = (raw, isBlob) => {
  let res;
  const pos = raw::stringIndexOf(',');
  const mimeType = pos < 0 ? '' : raw::slice(0, pos);
  const mimeData = pos < 0 ? raw : raw::slice(pos + 1);
  if (isBlob === false) {
    return `data:${mimeType};base64,${mimeData}`;
  }
  res = safeAtob(mimeData);
  // TODO: do the check in BG and cache/store the result because safe-guarding all the stuff
  // regexp picks from an instance internally is inordinately complicated
  if (/[\x80-\xFF]/::regexpTest(res)) {
    const len = res.length;
    const bytes = new SafeUint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = safeCharCodeAt(res, i);
    }
    res = isBlob ? bytes : new SafeTextDecoder()::tdDecode(bytes);
  }
  return isBlob
    ? createObjectURL(new SafeBlob([res], { type: mimeType }))
    : res;
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
