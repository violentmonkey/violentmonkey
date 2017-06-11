const arrayProto = Array.prototype;

const bindThis = func => (thisObj, ...args) => func.apply(thisObj, args);

export const forEach = bindThis(arrayProto.forEach);

export const map = bindThis(arrayProto.map);

export const indexOf = bindThis(arrayProto.indexOf);

export const includes = arrayProto.includes
  ? bindThis(arrayProto.includes)
  : (arr, item) => indexOf(arr, item) >= 0;

export const toString = bindThis(Object.prototype.toString);

export const assign = Object.assign || ((obj, ...args) => {
  forEach(args, arg => {
    if (arg) {
      forEach(Object.keys(arg), key => {
        obj[key] = arg[key];
      });
    }
  });
  return obj;
});

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
      const promise = Promise.all(body.getAll(key).map(value => encodeBody(value)))
      .then(values => ({ key, values }));
      promises.push(promise);
    }
    result = Promise.all(promises)
    .then(items => items.reduce((res, item) => {
      res[item.key] = item.values;
      return res;
    }, {}))
    .then(value => ({ cls, value }));
  } else if (includes(['blob', 'file'], cls)) {
    const bufsize = 8192;
    result = new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        let value = '';
        const array = new Uint8Array(reader.result);
        for (let i = 0; i < array.length; i += bufsize) {
          value += String.fromCharCode.apply(null, array.subarray(i, i + bufsize));
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
      value: JSON.stringify(body),
    };
  }
  return Promise.resolve(result);
}

function getType(obj) {
  const type = typeof obj;
  if (type !== 'object') return type;
  const typeString = toString(obj); // [object TYPENAME]
  return typeString.slice(8, -1).toLowerCase();
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
    c1 = utftext.charCodeAt(i);
    if (c1 < 128) {
      string += String.fromCharCode(c1);
      i += 1;
    } else if (c1 > 191 && c1 < 224) {
      c2 = utftext.charCodeAt(i + 1);
      string += String.fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = utftext.charCodeAt(i + 1);
      c3 = utftext.charCodeAt(i + 2);
      string += String.fromCharCode(((c1 & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      i += 3;
    }
  }
  return string;
  /* eslint-enable no-bitwise */
}
