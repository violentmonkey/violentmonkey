import { objectPick } from '#/common/object';
import {
  filter, includes, join, map, push, jsonDump, jsonLoad, objectToString, Promise, Uint8Array,
  setAttribute, log, fromCharCode, shift, slice, defineProperty,
  createElementNS, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};
const queue = [];

const { DOMParser, fetch } = global;
const { blob: getBlob, arrayBuffer: getArrayBuffer } = Response.prototype;
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
    data: [
      'abort',
      'error',
      'load',
      // 'loadend' will always be sent for internal cleanup
      'progress',
      'readystatechange',
      'timeout',
    ]::filter(e => typeof details[`on${e}`] === 'function'),
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
  // arraybuffer, blob, text
  return response;
}

// request object functions
async function callback(req, msg) {
  const cb = req.details[`on${msg.type}`];
  if (cb) {
    const reqType = req.details.responseType;
    const { data } = msg;
    let { response } = data;
    const url = msg.isBlob && response;
    if (response && !('rawResponse' in req) && (reqType || 'text') !== 'text') {
      // the second message may be issued while blob is still being processed,
      // so we'll temporarily store the Promise which can be awaited in the second message
      if (url) response = (await fetch(url))::(reqType === 'blob' ? getBlob : getArrayBuffer)();
      req.rawResponse = response;
    }
    if (req.rawResponse?.then) {
      req.rawResponse = await req.rawResponse;
      bridge.post({ cmd: 'RevokeObjectURL', data: url });
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
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { withCredentials = true, anonymous = !withCredentials } = details;
  const payload = {
    id,
    scriptId,
    anonymous,
    ...objectPick(details, [
      'headers',
      'method',
      'overrideMimeType',
      'password',
      'timeout',
      'url',
      'user',
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
