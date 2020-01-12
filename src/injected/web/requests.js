import { objectPick } from '#/common/object';
import {
  filter, includes, map, push, jsonDump, jsonLoad, objectToString, Promise, Uint8Array,
  setAttribute, log, buffer2stringSafe, charCodeAt, shift, slice, defineProperty,
  createElementNS, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};
const queue = [];

const { DOMParser } = global;
const { parseFromString } = DOMParser.prototype;
const { toLowerCase } = String.prototype;
const getHref = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href').get;

bridge.addHandlers({
  GotRequestId(id) {
    const req = queue::shift();
    if (req) start(req, id);
  },
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (req) callback(req, msg);
  },
});

export function onRequestCreate(details, scriptId) {
  const req = {
    scriptId,
    details,
    req: {
      abort() {
        reqAbort(req.id);
      },
    },
  };
  details.url = getFullUrl(details.url);
  queue::push(req);
  bridge.post({
    cmd: 'GetRequestId',
    data: {
      eventsToNotify: [
        'abort',
        'error',
        'load',
        // 'loadend' will always be sent for internal cleanup
        'progress',
        'readystatechange',
        'timeout',
      ]::filter(e => typeof details[`on${e}`] === 'function'),
      wantsBlob: details.responseType === 'blob',
    },
  });
  return req.req;
}

function reqAbort(id) {
  bridge.post({ cmd: 'AbortRequest', data: id });
}

function parseData(response, req, details) {
  const { responseType } = details;
  if (responseType === 'json') {
    return jsonLoad(response);
  }
  if (responseType === 'document') {
    const type = req.contentType.split(';', 1)[0] || 'text/html';
    return new DOMParser()::parseFromString(response, type);
  }
  // arraybuffer, blob
  if (req.isBlob) {
    const len = response.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) arr[i] = response::charCodeAt(i);
    return responseType === 'blob'
      ? new Blob([arr], { type: req.contentType })
      : arr.buffer;
  }
  // text
  return response;
}

// request object functions
function callback(req, msg) {
  const cb = req.details[`on${msg.type}`];
  if (cb) {
    const { data } = msg;
    if (data.response
    && !('rawResponse' in req)
    && (req.details.responseType || 'text') !== 'text') {
      req.rawResponse = data.response;
    }
    if ('rawResponse' in req) {
      defineProperty(data, 'response', {
        configurable: true,
        get() {
          const value = parseData(req.rawResponse, msg, req.details);
          defineProperty(this, 'response', { value });
          return value;
        },
      });
    }
    data.context = req.details.context;
    cb(data);
  }
  if (msg.type === 'loadend') delete idMap[req.id];
}

async function start(req, id) {
  const { details, scriptId } = req;
  const payload = {
    id,
    scriptId,
    ...objectPick(details, [
      'anonymous',
      'headers',
      'method',
      'overrideMimeType',
      'password',
      'timeout',
      'url',
      'user',
      'withCredentials',
    ]),
  };
  req.id = id;
  idMap[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (['arraybuffer', 'blob']::includes(responseType)) {
      payload.responseType = 'blob';
    } else if (!['document', 'json', 'text']::includes(responseType)) {
      log('warn', null, `Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  // TM/GM-compatibility: the `binary` option works only with a string `data`
  payload.data = details.binary
    ? { value: `${details.data}`, cls: 'blob' }
    : await encodeBody(details.data);
  bridge.post({ cmd: 'HttpRequest', data: payload });
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
      reader.onload = () => resolve({
        cls,
        value: buffer2stringSafe(reader.result),
        type: body.type,
        name: body.name,
        lastModified: body.lastModified,
      });
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
