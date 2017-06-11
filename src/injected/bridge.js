/**
 * All functions to be injected into web page must be independent.
 * They must be assigned to `bridge` so that they can be serialized.
 */
import { getUniqId, postData, noop } from './utils';

function post(data) {
  const bridge = this;
  bridge.postData(bridge.destId, data);
}

function prepare(src, dest) {
  const bridge = this;
  const { helpers } = bridge;
  const arrayProto = Array.prototype;
  const bindThis = func => (thisObj, ...args) => func.apply(thisObj, args);
  helpers.forEach = bindThis(arrayProto.forEach);
  helpers.map = bindThis(arrayProto.map);
  helpers.indexOf = bindThis(arrayProto.indexOf);
  helpers.includes = arrayProto.includes
  ? bindThis(arrayProto.includes)
  : (arr, item) => helpers.indexOf(arr, item) >= 0;
  helpers.toString = bindThis(Object.prototype.toString);

  const { vmid } = bridge;
  const srcId = vmid + src;
  bridge.destId = vmid + dest;
  document.addEventListener(srcId, e => {
    const data = JSON.parse(e.detail);
    bridge.handle(data);
  }, false);
}

function encodeBody(body) {
  const helpers = this;
  const cls = helpers.getType(body);
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
      const promise = Promise.all(body.getAll(key).map(value => helpers.encodeBody(value)))
      .then(values => ({ key, values }));
      promises.push(promise);
    }
    result = Promise.all(promises)
    .then(items => items.reduce((res, item) => {
      res[item.key] = item.values;
      return res;
    }, {}))
    .then(value => ({ cls, value }));
  } else if (helpers.includes(['blob', 'file'], cls)) {
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

function initialize(src, dest) {
  this.prepare(src, dest);
}

export default {
  postData,
  post,
  getUniqId,
  prepare,
  initialize,
  helpers: {
    noop,
    encodeBody,
    getType(obj) {
      const helpers = this;
      const type = typeof obj;
      if (type !== 'object') return type;
      const typeString = helpers.toString(obj); // [object TYPENAME]
      return typeString.slice(8, -1).toLowerCase();
    },
  },
  vmid: `VM_${getUniqId()}`,
};
