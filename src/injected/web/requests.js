import { assign, defineProperty, describeProperty, objectPick } from '#/common/object';
import {
  filter, forEach, includes, map, jsonDump, jsonLoad, objectToString, Promise,
  setAttribute, log, charCodeAt, slice,
  createElementNS, NS_HTML,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};

export const { atob } = global;
const { Blob, DOMParser, Error, FileReader, Uint8Array } = global;
const { parseFromString } = DOMParser.prototype;
const { then } = Promise.prototype;
const { indexOf, toLowerCase } = String.prototype;
const { get: getHref } = describeProperty(HTMLAnchorElement.prototype, 'href');
const { keys, getAll } = FormData.prototype;
const { readAsDataURL } = FileReader.prototype;
const promiseAll = Promise.all;

bridge.addHandlers({
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (req) callback(req, msg);
  },
});

export function onRequestCreate(opts, scriptId) {
  if (!opts.url) throw new Error('Required parameter "url" is missing.');
  const req = {
    scriptId,
    opts,
    req: {
      abort() {
        bridge.post('AbortRequest', req.id);
      },
    },
  };
  opts.url = getFullUrl(opts.url);
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
    ]::filter(e => typeof opts[`on${e}`] === 'function'),
    wantsBlob: opts.responseType === 'blob',
  })
  ::then(id => start(req, id));
  return req.req;
}

function parseData(req, msg, opts) {
  const response = req.raw;
  const { responseType } = opts;
  if (responseType === 'json') {
    return jsonLoad(response);
  }
  if (responseType === 'document') {
    const type = msg.contentType.split(';', 1)[0] || 'text/html';
    return new DOMParser()::parseFromString(response, type);
  }
  // arraybuffer/blob in incognito tabs is transferred as ArrayBuffer encoded in string chunks
  if (msg.chunked) {
    const arr = new Uint8Array(req.dataSize);
    let dstIndex = 0;
    response::forEach((chunk) => {
      const len = (chunk = atob(chunk)).length;
      for (let j = 0; j < len; j += 1, dstIndex += 1) {
        arr[dstIndex] = chunk::charCodeAt(j);
      }
    });
    return responseType === 'blob'
      ? new Blob([arr], { type: msg.contentType })
      : arr.buffer;
  }
  // text, blob, arraybuffer
  return response;
}

// request object functions
async function callback(req, msg) {
  if (msg.chunk) {
    receiveChunk(req, msg.chunk);
    return;
  }
  const { chunksPromise, opts } = req;
  const cb = opts[`on${msg.type}`];
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
    const isText = ['text']::includes(opts.responseType || 'text');
    if (!isText && response && !('raw' in req)) {
      req.raw = msg.chunked
        ? receiveAllChunks(req, response, msg)
        : response;
    }
    if (req.raw?.then) {
      req.raw = await req.raw;
    }
    defineProperty(data, 'response', {
      configurable: true,
      get() {
        const value = 'raw' in req ? parseData(req, msg, opts) : response;
        defineProperty(this, 'response', { value });
        return value;
      },
    });
    if (headers != null) req.headers = headers;
    if (text != null) req.text = text[0] === 'same' ? response : text;
    data.context = opts.context;
    data.responseHeaders = req.headers;
    data.responseText = req.text;
    cb(data);
  }
  if (msg.type === 'loadend') delete idMap[req.id];
}

function receiveAllChunks(req, response, { dataSize, numChunks }) {
  let res = [response];
  req.dataSize = dataSize;
  if (numChunks > 1) {
    req.chunks = res;
    req.chunksPromise = new Promise(resolve => {
      req.resolve = resolve;
    });
    res = req.chunksPromise;
  }
  return res;
}

function receiveChunk(req, { data, i, last }) {
  const { chunks } = req;
  chunks[i] = data;
  if (last) {
    req.resolve(chunks);
    delete req.chunksPromise;
    delete req.chunks;
    delete req.resolve;
  }
}

async function start(req, id) {
  const { opts, scriptId } = req;
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { withCredentials = true, anonymous = !withCredentials } = opts;
  const payload = assign({
    id,
    scriptId,
    anonymous,
  }, objectPick(opts, [
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
  const { responseType } = opts;
  if (responseType) {
    if (['arraybuffer', 'blob']::includes(responseType)) {
      payload.responseType = responseType;
    } else if (!['document', 'json', 'text']::includes(responseType)) {
      log('warn', null, `Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  // TM/GM-compatibility: the `binary` option works only with a string `data`
  payload.data = opts.binary
    ? { value: `${opts.data}`, cls: 'blob' }
    : await encodeBody(opts.data);
  bridge.post('HttpRequest', payload);
}

function getFullUrl(url) {
  const a = document::createElementNS(NS_HTML, 'a');
  a::setAttribute('href', url);
  return a::getHref();
}

async function encodeBody(body) {
  const cls = body::objectToString()::slice(8, -1)::toLowerCase(); // [object TYPENAME]
  switch (cls) {
  case 'formdata': {
    const data = {};
    const resolveKeyValues = async (key) => {
      const values = body::getAll(key)::map(encodeBody);
      data[key] = await promiseAll(values);
    };
    await promiseAll([...body::keys()]::map(resolveKeyValues));
    return { cls, value: data };
  }
  case 'blob':
  case 'file':
    // TODO: implement BufferSource (ArrayBuffer, DataView, typed arrays)
    return {
      cls,
      type: body.type,
      name: body.name,
      lastModified: body.lastModified,
      // Firefox can send Blob/File/BufferSource directly
      value: bridge.isFirefox ? body : await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result;
          resolve(res::slice(res::indexOf(',') + 1));
        };
        reader::readAsDataURL(body);
      }),
    };
  default:
    if (body != null) return { cls, value: jsonDump(body) };
  }
}
