// cache native properties to avoid being overridden, see violentmonkey/violentmonkey#151
// Firefox sucks: `isFinite` is not defined on `window`, see violentmonkey/violentmonkey#300
// eslint-disable-next-line no-restricted-properties
export const {
  // types
  Boolean, Error, Promise, Uint8Array,
  // props and methods
  atob, isFinite, setTimeout,
} = global;

export const {
  concat, filter, findIndex, forEach, includes, indexOf, join, map, push, shift,
  // arraySlice, // to differentiate from String::slice which we use much more often
} = Array.prototype;

export const {
  keys: objectKeys, values: objectValues, entries: objectEntries,
  assign, defineProperty, getOwnPropertyDescriptor: describeProperty,
} = Object;
export const {
  charCodeAt, match, slice, replace,
} = String.prototype;
export const { toString: objectToString } = Object.prototype;
const { toString: numberToString } = Number.prototype;
export const { fromCharCode } = String;
export const { addEventListener, removeEventListener } = EventTarget.prototype;
export const { append, remove, setAttribute } = Element.prototype;
export const { createElementNS } = Document.prototype;
export const logging = assign({}, console);

export const NS_HTML = 'http://www.w3.org/1999/xhtml';

export const isArray = obj => (
  // ES3 way, not reliable if prototype is modified
  // Object.prototype.toString.call(obj) === '[object Array]'
  // #565 steamcommunity.com has overridden `Array.prototype`
  // support duck typing
  obj && typeof obj.length === 'number' && typeof obj.splice === 'function'
);

export function noop() {}

/**
 * http://www.webtoolkit.info/javascript-utf8.html
 */
export function utf8decode(utftext) {
  /* eslint-disable no-bitwise */
  let string = '';
  let i = 0;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  while (i < utftext.length) {
    c1 = utftext::charCodeAt(i);
    if (c1 < 128) {
      string += fromCharCode(c1);
      i += 1;
    } else if (c1 > 191 && c1 < 224) {
      c2 = utftext::charCodeAt(i + 1);
      string += fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = utftext::charCodeAt(i + 1);
      c3 = utftext::charCodeAt(i + 2);
      string += fromCharCode(((c1 & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      i += 3;
    }
  }
  return string;
  /* eslint-enable no-bitwise */
}

// Reference: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/JSON#Polyfill
const escMap = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
const escRE = /[\\"\u0000-\u001F\u2028\u2029]/g; // eslint-disable-line no-control-regex
const escFunc = m => escMap[m] || `\\u${(m::charCodeAt(0) + 0x10000)::numberToString(16)::slice(1)}`;
export const jsonLoad = JSON.parse;
// When running in the page context we must beware of sites that override Array#toJSON
// leading to an invalid result, which is why our jsonDump() ignores toJSON.
// Thus, we use the native JSON.stringify() only in the content script context and only until
// a userscript is injected into this context (due to `@inject-into` and/or a CSP problem).
export function jsonDump(value) {
  if (value == null) return 'null';
  const type = typeof value;
  if (type === 'number') return isFinite(value) ? `${value}` : 'null';
  if (type === 'boolean') return `${value}`;
  if (type === 'object') {
    if (isArray(value)) {
      return `[${value::map(jsonDump)::join(',')}]`;
    }
    if (value::objectToString() === '[object Object]') {
      const res = objectKeys(value)::map((key) => {
        const v = value[key];
        return v !== undefined && `${jsonDump(key)}:${jsonDump(v)}`;
      });
      // JSON.stringify skips undefined in objects i.e. {foo: undefined} produces {}
      return `{${res::filter(Boolean)::join(',')}}`;
    }
  }
  return `"${value::replace(escRE, escFunc)}"`;
}

export function log(level, tags, ...args) {
  const tagList = ['Violentmonkey'];
  if (tags) tagList::push(...tags);
  const prefix = tagList::map(tag => `[${tag}]`)::join('');
  logging[level](prefix, ...args);
}

// uses ::safe calls unlike buffer2string in #/common
export function buffer2stringSafe(buf) {
  const size = buf.byteLength;
  // The max number of arguments varies between JS engines but it's >32k so 10k is safe
  const stepSize = 10e3;
  const stringChunks = [];
  for (let from = 0; from < size; from += stepSize) {
    const sourceChunk = new Uint8Array(buf, from, Math.min(stepSize, size - from));
    stringChunks::push(fromCharCode(...sourceChunk));
  }
  return stringChunks::join('');
}
