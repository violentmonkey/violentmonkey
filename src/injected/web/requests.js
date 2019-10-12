import {
  atob, includes, join, map, push, jsonDump, jsonLoad, objectToString, Promise, Blob, Uint8Array,
  setAttribute, log, charCodeAt, fromCharCode, match, shift, slice,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};
const queue = [];

const NS_HTML = 'http://www.w3.org/1999/xhtml';

const { toLowerCase } = String.prototype;
const { createElementNS } = Document.prototype;
const getHref = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href').get;

bridge.addHandlers({
  GotRequestId(id) {
    const req = queue::shift();
    if (req) start(req, id);
  },
  HttpRequested(res) {
    const req = idMap[res.id];
    if (req) callback(req, res);
  },
});

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
  if (res.type === 'loadend') delete idMap[req.id];
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
  idMap[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (['arraybuffer', 'blob']::includes(responseType)) {
      payload.responseType = 'arraybuffer';
    } else if (!['json', 'text']::includes(responseType)) {
      log('warn', null, `Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
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
  return a::getHref();
}

const { keys, getAll } = FormData.prototype;
const { FileReader } = global;
const { readAsArrayBuffer } = FileReader.prototype;

async function encodeBody(body) {
  const cls = getType(body);
  switch (cls) {
  case 'formdata': {
    const data = {};
    const resolveKeyValues = async (key) => {
      const values = body::getAll(key)::map(encodeBody);
      data[key] = await Promise.all(values);
    };
    await Promise.all([...body::keys()]::map(resolveKeyValues));
    return { cls, value: data };
  }
  case 'blob':
  case 'file':
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buf = reader.result;
        const size = buf.byteLength;
        // The max number of arguments varies between JS engines but it's >32k so 10k is safe
        const stepSize = 10e3;
        const stringChunks = [];
        for (let from = 0; from < size; from += stepSize) {
          const sourceChunk = new Uint8Array(buf, from, Math.min(stepSize, size - from));
          stringChunks::push(fromCharCode(...sourceChunk));
        }
        resolve({
          cls,
          value: stringChunks::join(''),
          type: body.type,
          name: body.name,
          lastModified: body.lastModified,
        });
      };
      reader::readAsArrayBuffer(body);
    });
  default:
    if (body) return { cls, value: jsonDump(body) };
  }
}

function getType(obj) {
  const type = typeof obj;
  if (type !== 'object') return type;
  const typeString = obj::objectToString(); // [object TYPENAME]
  return typeString::slice(8, -1)::toLowerCase();
}
