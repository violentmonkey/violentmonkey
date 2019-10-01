// cache native properties to avoid being overridden, see violentmonkey/violentmonkey#151
// Firefox sucks: `isFinite` is not defined on `window`, see violentmonkey/violentmonkey#300
// eslint-disable-next-line no-restricted-properties
export const {
  console, Promise, isFinite, Uint8Array, setTimeout, atob, Blob, Error, Boolean,
} = global;

const arrayProto = Array.prototype;
const objectProto = Object.prototype;
const stringProto = String.prototype;

// binding takes times so we need to keep the amount of bound methods low
// TODO: investigate Babel macros/plugins API to make using safe functions much more convenient
const bindThis = func => (thisObj, ...args) => func.apply(thisObj, args);

export const concat = bindThis(arrayProto.concat);
export const filter = bindThis(arrayProto.filter);
export const forEach = bindThis(arrayProto.forEach);
export const join = bindThis(arrayProto.join);
export const map = bindThis(arrayProto.map);
export const indexOf = bindThis(arrayProto.indexOf);
export const push = bindThis(arrayProto.push);
export const shift = bindThis(arrayProto.shift);

export const includes = arrayProto.includes
  ? bindThis(arrayProto.includes)
  : (arr, item) => indexOf(arr, item) >= 0;

export const toString = bindThis(objectProto.toString);
export const stringCharCodeAt = bindThis(stringProto.charCodeAt);
export const stringLastIndexOf = bindThis(stringProto.lastIndexOf);
export const stringMatch = bindThis(stringProto.match);
export const stringSlice = bindThis(stringProto.slice);
export const stringStarts = bindThis(stringProto.startsWith);
const numberToString = bindThis(Number.prototype.toString);
const stringReplace = bindThis(stringProto.replace);
const stringToLower = bindThis(stringProto.toLowerCase);
const { fromCharCode } = String;

export const { keys: objectKeys, defineProperty, defineProperties } = Object;
export const assign = Object.assign || ((obj, ...args) => {
  forEach(args, (arg) => {
    if (arg) {
      forEach(objectKeys(arg), (key) => {
        obj[key] = arg[key];
      });
    }
  });
  return obj;
});

export const isArray = obj => (
  // ES3 way, not reliable if prototype is modified
  // toString(obj) === '[object Array]'
  // #565 steamcommunity.com has overridden `Array.prototype`
  // support duck typing
  obj && typeof obj.length === 'number' && typeof obj.splice === 'function'
);

export const { warn } = console;

export function encodeBody(body) {
  const cls = getType(body);
  let result;
  if (cls === 'formdata') {
    // FormData#keys is supported in Chrome >= 50
    if (!body.keys) return {};
    const promises = [];
    const iterator = body.keys();
    while (1) { // eslint-disable-line no-constant-condition
      const item = iterator.next();
      if (item.done) break;
      const key = item.value;
      const promise = Promise.all(map(body.getAll(key), encodeBody))
      .then(values => ({ key, values }));
      push(promises, promise);
    }
    result = Promise.all(promises)
    .then((items) => {
      const res = {};
      forEach(items, (item) => {
        res[item.key] = item.values;
      });
      return res;
    })
    .then(value => ({ cls, value }));
  } else if (includes(['blob', 'file'], cls)) {
    result = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        // In Firefox, Uint8Array cannot be sliced if its data is read by FileReader
        const array = new Uint8Array(reader.result);
        let value = '';
        for (let i = 0; i < array.length; i += 1) {
          value += fromCharCode(array[i]);
        }
        resolve({
          cls,
          value,
          type: body.type,
          name: body.name,
          lastModified: body.lastModified,
        });
      };
      reader.readAsArrayBuffer(body);
    });
  } else if (body) {
    result = {
      cls,
      value: jsonDump(body),
    };
  }
  return Promise.resolve(result);
}

function getType(obj) {
  const type = typeof obj;
  if (type !== 'object') return type;
  const typeString = toString(obj); // [object TYPENAME]
  return stringToLower(stringSlice(typeString, 8, -1));
}

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
    c1 = stringCharCodeAt(utftext, i);
    if (c1 < 128) {
      string += fromCharCode(c1);
      i += 1;
    } else if (c1 > 191 && c1 < 224) {
      c2 = stringCharCodeAt(utftext, i + 1);
      string += fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = stringCharCodeAt(utftext, i + 1);
      c3 = stringCharCodeAt(utftext, i + 2);
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
const escFunc = m => escMap[m] || `\\u${stringSlice(numberToString(stringCharCodeAt(m, 0) + 0x10000, 16), 1)}`;
export const jsonLoad = JSON.parse;
let jsonDumpFunction = jsonDumpSafe;
// When running in the page context we must beware of sites that override Array#toJSON
// leading to an invalid result, which is why our jsonDumpSafe() ignores toJSON.
// Thus, we use the native JSON.stringify() only in the content script context and only until
// a userscript is injected into this context (due to `@inject-into` and/or a CSP problem).
export function setJsonDump({ native }) {
  jsonDumpFunction = native ? JSON.stringify : jsonDumpSafe;
}
export function jsonDump(value) {
  return jsonDumpFunction(value);
}
function jsonDumpSafe(value) {
  if (value == null) return 'null';
  const type = typeof value;
  if (type === 'number') return isFinite(value) ? `${value}` : 'null';
  if (type === 'boolean') return `${value}`;
  if (type === 'object') {
    if (isArray(value)) {
      return `[${join(map(value, jsonDumpSafe), ',')}]`;
    }
    if (toString(value) === '[object Object]') {
      const res = map(objectKeys(value), (key) => {
        const v = value[key];
        return v !== undefined && `${jsonDumpSafe(key)}:${jsonDumpSafe(v)}`;
      });
      // JSON.stringify skips undefined in objects i.e. {foo: undefined} produces {}
      return `{${join(filter(res, Boolean), ',')}}`;
    }
  }
  return `"${stringReplace(value, escRE, escFunc)}"`;
}
