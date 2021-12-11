// eslint-disable-next-line no-restricted-imports
export { sendCmd } from '#/common';

/** When looking for documentElement, use '*' to also support XML pages
 * Note that we avoid spoofed prototype getters by using hasOwnProperty, and not using `length`
 * as it searches for ALL matching nodes when this tag wasn't cached internally. */
export const elemByTag = (tag, i) => getOwnProp(document::getElementsByTagName(tag), i || 0);

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
  const el = document::createElementNS(NS_HTML, tag);
  if (attrs && isString(attrs)) {
    el::append(attrs);
  } else if (attrs) {
    objectKeys(attrs)::forEach(key => {
      if (key === 'textContent') el::append(attrs[key]);
      else el::setAttribute(key, attrs[key]);
    });
  }
  return el;
};

export const getFullUrl = url => (
  makeElem('a', { href: url })::getHref()
);

export const decodeResource = (raw, isBlob) => {
  let res;
  const pos = raw::stringIndexOf(',');
  const mimeType = pos < 0 ? '' : raw::slice(0, pos);
  const mimeData = pos < 0 ? raw : raw::slice(pos + 1);
  if (isBlob === false) {
    return `data:${mimeType};base64,${mimeData}`;
  }
  const bin = safeAtob(mimeData);
  if (isBlob || /[\x80-\xFF]/::regexpTest(bin)) {
    const len = bin.length;
    const bytes = new SafeUint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = bin::charCodeAt(i);
    }
    res = isBlob
      ? new SafeBlob([bytes], { type: mimeType })
      : new SafeTextDecoder()::tdDecode(bytes);
  } else { // pure ASCII
    res = bin;
  }
  return res;
};
