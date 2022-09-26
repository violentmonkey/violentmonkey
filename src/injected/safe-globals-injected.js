/* eslint-disable no-unused-vars */

/**
 * This file is used by both `injected` and `injected-web` entries.
 * `global` is used instead of WebPack's polyfill which we disable in webpack.conf.js.
 * `export` is stripped in the final output and is only used for our NodeJS test scripts.
 * WARNING! Don't use exported functions from @/common anywhere in injected!
 */

const global = (function _() {
  return this || globalThis; // eslint-disable-line no-undef
}());
/** These two are unforgeable so we extract them primarily to improve minification.
 * The document's value can change only in about:blank but we don't inject there. */
const { document, window } = global;
export const PROTO = 'prototype';
export const IS_TOP = window.top === window;
export const WINDOW_CLOSE = 'window.close';
export const WINDOW_FOCUS = 'window.focus';
export const NS_HTML = 'http://www.w3.org/1999/xhtml';
export const CALLBACK_ID = '__CBID';
/** These toString are used to avoid leaking data when converting into a string */
const { toString: numberToString } = 0;
const { toString: URLToString } = URL[PROTO];

export const throwIfProtoPresent = process.env.DEBUG && (obj => {
  if (!obj || obj.__proto__) { // eslint-disable-line no-proto
    throw 'proto is not null';
  }
});
export const isFunction = val => typeof val === 'function';
export const isObject = val => val !== null && typeof val === 'object';
export const isPromise = val => {
  // Checking if val is thenable per JS spec
  if (isObject(val)) {
    try { return isFunction(val.then); } catch (e) { /* NOP */ }
  }
};
export const isString = val => typeof val === 'string';

export const getOwnProp = (obj, key) => {
  // obj may be a Proxy that throws in has() or its getter throws
  try {
    if (obj::hasOwnProperty(key)) return obj[key];
  } catch (e) { /* NOP */ }
};

/** Workaround for array eavesdropping via prototype setters like '0','1',...
 * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
 * its length or from an unassigned `hole`. */
export const setOwnProp = (obj, key, value, mutable = true) => (
  defineProperty(obj, key, {
    __proto__: null,
    value,
    configurable: mutable,
    enumerable: mutable,
    writable: mutable,
  })
);

export const vmOwnFuncToString = () => '[Violentmonkey property]';

/** `dst` must have a null proto */
export const pickIntoNullObj = (dst, src, keys) => {
  if (process.env.DEBUG) throwIfProtoPresent(dst);
  if (src) {
    keys::forEach(key => {
      if (src::hasOwnProperty(key)) {
        dst[key] = src[key];
      }
    });
  }
  return dst;
};

/**
 * Helps avoid interception via `Object.prototype`.
 * @param {Object} [base] - source object to copy as a null-proto object
 * @param {Object} [src] - source object to pick from
 * @param {string[]} [keys] - all keys will be picked otherwise
 * @returns {Object} `base` if it's already without prototype, a new object otherwise
 */
export const createNullObj = (base, src, keys) => {
  // eslint-disable-next-line no-proto
  const res = { __proto__: null };
  if (base) {
    assign(res, base);
  }
  if (src) {
    if (keys) pickIntoNullObj(res, src, keys);
    else assign(res, src);
  }
  return res;
};

// WARNING! `obj` must use __proto__:null
export const ensureNestedProp = (obj, bucketId, key, defaultValue) => {
  if (process.env.DEBUG) throwIfProtoPresent(obj);
  const bucket = obj[bucketId] || (
    obj[bucketId] = createNullObj()
  );
  const val = bucket[key] ?? (
    bucket[key] = (defaultValue ?? createNullObj())
  );
  return val;
};

export const promiseResolve = () => (async () => {})();

export const vmOwnFunc = (func, toString) => (
  setOwnProp(func, 'toString', toString || vmOwnFuncToString, false)
);

// Using just one random() to avoid many methods in vault just for this
export const safeGetUniqId = (prefix = 'VM') => prefix + mathRandom()::numberToString(36);

/** args is [tags?, ...rest] */
export const log = (level, ...args) => {
  let s = '[Violentmonkey]';
  if (args[0]) args[0]::forEach(tag => { s += `[${tag}]`; });
  args[0] = s;
  logging[level]::apply(logging, args);
};

/**
 * Object.defineProperty seems to be inherently broken: it reads inherited props from desc
 * (even though the purpose of this API is to define own props) and then complains when it finds
 * invalid props like an inherited setter when you only provide `{value}`.
 */
export const safeDefineProperty = (obj, key, desc) => (
  defineProperty(obj, key, createNullObj(desc))
);

export const safePush = (arr, val) => (
  setOwnProp(arr, arr.length, val)
);
