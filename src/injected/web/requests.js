import { assign, defineProperty, describeProperty, objectPick } from '#/common/object';
import {
  filter, includes, map, jsonDump, jsonLoad, join, objectToString, Promise,
  setAttribute, log, buffer2stringSafe, charCodeAt, slice,
  createElementNS, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};

const { Blob, DOMParser, Error, Uint8Array } = global;
const { parseFromString } = DOMParser.prototype;
const { then } = Promise.prototype;
const { toLowerCase } = String.prototype;
const { get: getHref } = describeProperty(HTMLAnchorElement.prototype, 'href');

bridge.addHandlers({
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (req) callback(req, msg);
  },
});

export function onRequestCreate(details, scriptId) {
  if (!details.url) throw new Error('Required parameter "url" is missing.');
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
  bridge.send('GetRequestId', {
    eventsToNotify: [
      'abort',
      'error',
      'load',
      'loadend',
      'loadstart',
      'progress',
      'readystatechange',
      'timeout',
    ]::filter(e => typeof details[`on${e}`] === 'function'),
    wantsBlob: details.responseType === 'blob',
  })
  ::then(id => start(req, id));
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
  // arraybuffer/blob in incognito tabs is transferred as ArrayBuffer encoded in string chunks
  if (msg.chunkType === 'arraybuffer') {
    const len = response.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) arr[i] = response::charCodeAt(i);
    return responseType === 'blob'
      ? new Blob([arr], { type: msg.contentType })
      : arr.buffer;
  }
  // text, blob, arraybuffer
  return response;
}

// request object functions
async function callback(req, msg) {
  if (msg.chunk) return receiveChunk(req, msg);
  const { chunksPromise, details } = req;
  const cb = details[`on${msg.type}`];
  if (chunksPromise) {
    await chunksPromise;
  }
  if (cb) {
    const { data } = msg;
    const {
      response,
      responseHeaders: headers,
      responseText: text,
    } = data;
    const isText = ['text']::includes(details.responseType || 'text');
    if (!isText && response && !('raw' in req)) {
      req.raw = msg.numChunks > 1
        ? receiveAllChunks(req, response, msg.numChunks)
        : response;
    }
    if (req.raw?.then) {
      req.raw = await req.raw;
    }
    defineProperty(data, 'response', {
      configurable: true,
      get() {
        const value = 'raw' in req ? parseData(req.raw, msg, details) : response;
        defineProperty(this, 'response', { value });
        return value;
      },
    });
    if (headers != null) req.headers = headers;
    if (text != null) req.text = text[0] === 'same' ? response : text;
    data.context = details.context;
    data.responseHeaders = req.headers;
    data.responseText = req.text;
    cb(data);
  }
  if (msg.type === 'loadend') delete idMap[req.id];
}

function receiveAllChunks(req, response, numChunks) {
  req.chunks = [response];
  req.numChunks = numChunks;
  req.chunksPromise = new Promise(resolve => {
    req.resolve = resolve;
  });
  return req.chunksPromise;
}

function receiveChunk(req, { chunk, chunkIndex }) {
  const { chunks, numChunks } = req;
  chunks[chunkIndex] = chunk;
  if (chunkIndex === numChunks - 1) {
    delete req.chunksPromise;
    delete req.chunks;
    delete req.numChunks;
    req.resolve(chunks::join(''));
  }
}

async function start(req, id) {
  const { details, scriptId } = req;
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { withCredentials = true, anonymous = !withCredentials } = details;
  const payload = assign({
    id,
    scriptId,
    anonymous,
  }, objectPick(details, [
    'headers',
    'method',
    'overrideMimeType',
    'password',
    'timeout',
    'url',
    'user',
  ]));
  req.id = id;
  idMap[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (['arraybuffer', 'blob']::includes(responseType)) {
      payload.chunkType = 'blob';
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
    if (body != null) return { cls, value: jsonDump(body) };
  }
}

function getType(obj) {
  const type = typeof obj;
  if (type !== 'object') return type;
  const typeString = obj::objectToString(); // [object TYPENAME]
  return typeString::slice(8, -1)::toLowerCase();
}
