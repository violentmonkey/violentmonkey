/* eslint-disable no-unused-vars */

/**
 * This file runs before safe-globals of `injected-content` and `injected-web` entries.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * WARNING! Don't use exported functions from @/common anywhere in injected!
 */

export const PROTO = 'prototype';
export const CALLBACK_ID = '__CBID';

export const throwIfProtoPresent = __.DEBUG && (obj => {
  if (!obj || obj.__proto__) { // eslint-disable-line no-proto
    throw 'proto is not null';
  }
});
export const isString = val => typeof val === 'string';

export const getOwnProp = (obj, key, defVal) => {
  // obj may be a Proxy that throws in has() or its getter throws
  try {
    if (obj && hasOwnProperty(obj, key)) {
      defVal = obj[key];
    }
  } catch (e) { /* NOP */ }
  return defVal;
};

export const nullObjFrom = src => __.TEST
  ? global.Object.assign({ __proto__: null }, src)
  : assign(createNullObj(), src);

/** If `dst` has a proto, it'll be copied into a new proto:null object */
export const safePickInto = (dst, src, keys) => {
  setPrototypeOf(dst, null);
  if (src) {
    keys::forEach(key => {
      if (hasOwnProperty(src, key)) {
        dst[key] = src[key];
      }
    });
  }
  return dst;
};

export const promiseResolve = async val => val;

/** Not adding any prefix by default to make Spectre exfiltration harder */
export const safeGetUniqId = (prefix = '') => prefix + (
  U8_toBase64 // minimum_chrome_version>=140, strict_min_version>=133
  ? getRandomValues(new SafeUint8Array(12))::U8_toBase64()
  : safeBtoa(safeApply(stringFromCharCode, null, getRandomValues(new SafeUint8Array(16))))
);

/** args is [tags?, ...rest] */
export const log = (level, ...args) => {
  let s = `[${VIOLENTMONKEY}]`;
  if (args[0]) args[0]::forEach(tag => { s += `[${tag}]`; });
  args[0] = s;
  safeApply(logging[level], logging, args);
};

/** Unlike ::push() this one doesn't call possibly spoofed Array.prototype setters */
export const safePush = (arr, val) => (
  setOwnProp(arr, arr.length, val)
);
