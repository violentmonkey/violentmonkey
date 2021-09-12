import { assign, defineProperty, describeProperty, objectPick } from '#/common/object';
import {
  Error, Promise, Uint8Array,
  charCodeAt, filter, forEach, jsonLoad, log, replace, then,
  NS_HTML, addEventListener, createElementNS, setAttribute,
} from '../utils/helpers';
import bridge from './bridge';

const idMap = {};

export const { atob } = global;
const { Blob, DOMParser, FileReader, Response } = global;
const { parseFromString } = DOMParser.prototype;
const { blob: resBlob } = Response.prototype;
const { get: getHref } = describeProperty(HTMLAnchorElement.prototype, 'href');
const { readAsDataURL } = FileReader.prototype;

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

function parseData(req, msg) {
  let res;
  const { raw, opts: { responseType } } = req;
  if (responseType === 'text') {
    res = raw;
  } else if (responseType === 'json') {
    res = jsonLoad(raw);
  } else if (responseType === 'document') {
    const type = msg.contentType::replace(/^[^;]+/)?.[0] || 'text/html';
    res = new DOMParser()::parseFromString(raw, type);
  } else if (msg.chunked) {
    // arraybuffer/blob in incognito tabs is transferred as ArrayBuffer encoded in string chunks
    const arr = new Uint8Array(req.dataSize);
    let dstIndex = 0;
    raw::forEach((chunk) => {
      const len = (chunk = atob(chunk)).length;
      for (let j = 0; j < len; j += 1, dstIndex += 1) {
        arr[dstIndex] = chunk::charCodeAt(j);
      }
    });
    res = responseType === 'blob'
      ? new Blob([arr], { type: msg.contentType })
      : arr.buffer;
  } else {
    // text, blob, arraybuffer
    res = raw;
  }
  // `response` is sent only when changed so we need to remember it for response-less events
  req.response = res;
  // `raw` is decoded once per `response` change so we reuse the result just like native XHR
  delete req.raw;
  return res;
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
    if (response && !('raw' in req)) {
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
        const value = 'raw' in req ? parseData(req, msg) : req.response;
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
  const { data, withCredentials = true, anonymous = !withCredentials } = opts;
  req.id = id;
  idMap[id] = req;
  bridge.post('HttpRequest', assign({
    id,
    scriptId,
    anonymous,
    data: data == null && []
      // `binary` is for TM/GM-compatibility + non-objects = must use a string `data`
      || (opts.binary || typeof data !== 'object') && [`${data}`]
      // FF56+ can send any cloneable data directly, FF52-55 can't due to https://bugzil.la/1371246
      || (bridge.isFirefox >= 56) && [data]
      // TODO: support huge data by splitting it to multiple messages
      || await encodeBody(data),
    responseType: getResponseType(opts),
  }, objectPick(opts, [
    'headers',
    'method',
    'overrideMimeType',
    'password',
    'timeout',
    'url',
    'user',
  ])));
}

function getFullUrl(url) {
  const a = document::createElementNS(NS_HTML, 'a');
  a::setAttribute('href', url);
  return a::getHref();
}

function getResponseType({ responseType = '' }) {
  switch (responseType) {
  case 'arraybuffer':
  case 'blob':
    return responseType;
  case 'document':
  case 'json':
  case 'text':
  case '':
    break;
  default:
    log('warn', null, `Unknown responseType "${responseType}",`
      + ' see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.');
  }
  return '';
}

/** Polyfill for Chrome's inability to send complex types over extension messaging */
async function encodeBody(body) {
  const wasBlob = body instanceof Blob;
  const blob = wasBlob ? body : await new Response(body)::resBlob();
  const reader = new FileReader();
  return new Promise((resolve) => {
    reader::addEventListener('load', () => resolve([
      reader.result,
      blob.type,
      wasBlob,
    ]));
    reader::readAsDataURL(blob);
  });
}
