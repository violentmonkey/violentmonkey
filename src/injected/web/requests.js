import { objectPick } from '#/common/object';
import {
  filter, includes, map, push, jsonDump, jsonLoad, join, objectToString, Promise, Uint8Array,
  setAttribute, log, buffer2stringSafe, charCodeAt, slice, defineProperty, describeProperty,
  createElementNS, NS_HTML, Blob,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};

const { DOMParser } = global;
const { parseFromString } = DOMParser.prototype;
const { toLowerCase } = String.prototype;
const { get: getHref } = describeProperty(HTMLAnchorElement.prototype, 'href');

bridge.addHandlers({
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
        bridge.post('AbortRequest', req.id);
      },
    },
  };
  details.url = getFullUrl(details.url);
  const eventsToNotify = [
    'abort',
    'error',
    'load',
    'loadend',
    'loadstart',
    'progress',
    'readystatechange',
    'timeout',
  ]::filter(e => typeof details[`on${e}`] === 'function');
  bridge.send('GetRequestId', eventsToNotify)
  .then(id => start(req, id));
  return req.req;
}

function parseData(response, msg, details) {
  const { responseType } = details;
  if (responseType === 'json') {
    return jsonLoad(response);
  }
  if (responseType === 'document') {
    const type = msg.contentType.split(';', 1)[0] || 'text/html';
    return new DOMParser()::parseFromString(response, type);
  }
  // arraybuffer, blob
  if (msg.numChunks) {
    const len = response.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) arr[i] = response::charCodeAt(i);
    return responseType === 'blob'
      ? new Blob([arr], { type: msg.contentType })
      : arr.buffer;
  }
  // text
  return response;
}

// request object functions
async function callback(req, msg) {
  if (msg.chunk) return receiveChunk(req, msg);
  if (req.promise) await req.promise;
  const cb = (req.details)[`on${msg.type}`];
  if (cb) {
    const { data, numChunks } = msg;
    const { response } = data;
    if (response && !('rawResponse' in req) && (req.details.responseType || 'text') !== 'text') {
      req.rawResponse = numChunks > 1
        ? await receiveAllChunks(req, response, numChunks)
        : response;
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

function receiveAllChunks(req, response) {
  req.chunks = [response];
  req.promise = new Promise(resolve => {
    req.resolve = resolve;
  });
  return req.promise;
}

function receiveChunk(req, { chunk, isLastChunk }) {
  const { chunks } = req;
  chunks::push(chunk);
  if (isLastChunk) {
    delete req.promise;
    delete req.chunks;
    req.resolve(chunks::join(''));
  }
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
      payload.isBuffer = true;
      req.isBuffer = true;
    } else if (!['document', 'json', 'text']::includes(responseType)) {
      log('warn', null, `Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  // TM/GM-compatibility: the `binary` option works only with a string `data`
  payload.data = details.binary
    ? { value: `${details.data}`, cls: 'blob' }
    : await encodeBody(details.data);
  bridge.post('HttpRequest', payload);
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
