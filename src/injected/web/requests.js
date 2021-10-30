import { getUniqId, isFunction } from '#/common';
import { NS_HTML, createNullObj, getOwnProp, log, pickIntoThis } from '../util';
import bridge from './bridge';

const idMap = createNullObj();
const { DOMParser, FileReader, Response } = global;
const { parseFromString } = DOMParser[PROTO];
const { blob: resBlob } = Response[PROTO];
const { get: getHref } = describeProperty(HTMLAnchorElement[PROTO], 'href');
const { readAsDataURL } = FileReader[PROTO];

bridge.addHandlers({
  __proto__: null,
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (req) callback(req, msg);
  },
});

export function onRequestCreate(opts, context) {
  if (!opts.url) throw new ErrorSafe('Required parameter "url" is missing.');
  const scriptId = context.id;
  const id = getUniqId(`VMxhr${scriptId}`);
  const req = {
    __proto__: null,
    id,
    scriptId,
    opts,
  };
  start(req, context);
  return {
    abort() {
      bridge.post('AbortRequest', id, context);
    },
  };
}

function parseData(req, msg) {
  let res;
  const { raw, opts: { responseType } } = req;
  if (responseType === 'text') {
    res = raw;
  } else if (responseType === 'json') {
    res = jsonParse(raw);
  } else if (responseType === 'document') {
    // Cutting everything after , or ; and trimming whitespace
    const type = msg.contentType::replace(/[,;].*|\s+/g, '') || 'text/html';
    res = new DOMParser()::parseFromString(raw, type);
  } else if (msg.chunked) {
    // arraybuffer/blob in incognito tabs is transferred as ArrayBuffer encoded in string chunks
    // TODO: move this block in content if the speed is the same for very big data
    const arr = new Uint8ArraySafe(req.dataSize);
    let dstIndex = 0;
    raw::forEach((chunk) => {
      const len = (chunk = window::atobSafe(chunk)).length;
      for (let j = 0; j < len; j += 1, dstIndex += 1) {
        arr[dstIndex] = chunk::charCodeAt(j);
      }
    });
    res = responseType === 'blob'
      ? new BlobSafe([arr], { type: msg.contentType })
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
    // Spoofed String/Array index getters won't be called within length, length itself is unforgeable
    if (text != null) req.text = text.length && text[0] === 'same' ? response : text;
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
    req.chunksPromise = new PromiseSafe(resolve => {
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

async function start(req, context) {
  const { id, opts, scriptId } = req;
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { data, withCredentials = true, anonymous = !withCredentials } = opts;
  idMap[id] = req;
  bridge.post('HttpRequest', {
    __proto__: null,
    id,
    scriptId,
    anonymous,
    data: data == null && []
      // `binary` is for TM/GM-compatibility + non-objects = must use a string `data`
      || (opts.binary || typeof data !== 'object') && [`${data}`]
      // FF56+ can send any cloneable data directly, FF52-55 can't due to https://bugzil.la/1371246
      || IS_FIREFOX && bridge.ua.browserVersion >= 56 && [data]
      // TODO: support huge data by splitting it to multiple messages
      || await encodeBody(data),
    eventsToNotify: [
      'abort',
      'error',
      'load',
      'loadend',
      'loadstart',
      'progress',
      'readystatechange',
      'timeout',
    ]::filter(key => isFunction(getOwnProp(opts, `on${key}`))),
    responseType: getResponseType(opts),
    url: getFullUrl(opts.url),
    wantsBlob: opts.responseType === 'blob',
  }::pickIntoThis(opts, [
    'headers',
    'method',
    'overrideMimeType',
    'password',
    'timeout',
    'user',
  ]), context);
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
  const wasBlob = body::objectToString() === '[object Blob]';
  const blob = wasBlob ? body : await new Response(body)::resBlob();
  const reader = new FileReader();
  return new PromiseSafe((resolve) => {
    reader::on('load', () => resolve([
      reader.result,
      blob.type,
      wasBlob,
    ]));
    reader::readAsDataURL(blob);
  });
}
