import {
  atob, forEach, includes, push, jsonDump, jsonLoad, objectToString, Blob, Uint8Array, warn,
  charCodeAt, fromCharCode, match, slice, setAttribute,
} from '../utils/helpers';
import bridge from './bridge';

const map = {};
const queue = [];

const NS_HTML = 'http://www.w3.org/1999/xhtml';

const { shift } = Array.prototype;
const { toLowerCase } = String.prototype;
const { createElementNS } = Document.prototype;
const hrefGet = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href').get;

export function onRequestCreate(details) {
  const req = {
    details,
    req: {
      abort: reqAbort,
    },
  };
  details.url = getFullUrl(details.url);
  queue::push(req);
  bridge.post({ cmd: 'GetRequestId' });
  return req.req;
}

export function onRequestStart(id) {
  const req = queue::shift();
  if (req) start(req, id);
}

export function onRequestCallback(res) {
  const req = map[res.id];
  if (req) callback(req, res);
}

function reqAbort() {
  bridge.post({ cmd: 'AbortRequest', data: this.id });
}

function parseData(req, details) {
  if (req.resType) {
    // blob or arraybuffer
    const { response } = req.data;
    if (response) {
      const matches = response::match(/^data:([^;,]*);base64,/);
      if (!matches) {
        // invalid
        req.data.response = null;
      } else {
        const raw = atob(response::slice(matches[0].length));
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) arr[i] = raw::charCodeAt(i);
        if (details.responseType === 'blob') {
          // blob
          return new Blob([arr], { type: matches[1] });
        }
        // arraybuffer
        return arr.buffer;
      }
    }
  } else if (details.responseType === 'json') {
    // json
    return jsonLoad(req.data.response);
  } else {
    // text
    return req.data.response;
  }
}

// request object functions
function callback(req, res) {
  const cb = req.details[`on${res.type}`];
  if (cb) {
    if (res.data.response) {
      if (!req.data) req.data = [parseData(res, req.details)];
      [res.data.response] = req.data;
    }
    res.data.context = req.details.context;
    cb(res.data);
  }
  if (res.type === 'loadend') delete map[req.id];
}

function start(req, id) {
  const { details } = req;
  const payload = {
    id,
    anonymous: details.anonymous,
    method: details.method,
    url: details.url,
    user: details.user,
    password: details.password,
    headers: details.headers,
    timeout: details.timeout,
    overrideMimeType: details.overrideMimeType,
  };
  req.id = id;
  map[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (['arraybuffer', 'blob']::includes(responseType)) {
      payload.responseType = 'arraybuffer';
    } else if (!['json', 'text']::includes(responseType)) {
      warn(`[Violentmonkey] Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  encodeBody(details.data)
  .then((body) => {
    payload.data = body;
    bridge.post({
      cmd: 'HttpRequest',
      data: payload,
    });
  });
}

function getFullUrl(url) {
  const a = document::createElementNS(NS_HTML, 'a');
  a::setAttribute('href', url);
  return a::hrefGet();
}

function encodeBody(body) {
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
      const promise = Promise.all(body.getAll(key)::map(encodeBody))
      .then(values => ({ key, values }));
      promises::push(promise);
    }
    result = Promise.all(promises)
    .then((items) => {
      const res = {};
      items::forEach((item) => {
        res[item.key] = item.values;
      });
      return res;
    })
    .then(value => ({ cls, value }));
  } else if (['blob', 'file']::includes(cls)) {
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
  const typeString = obj::objectToString(); // [object TYPENAME]
  return typeString::slice(8, -1)::toLowerCase();
}
