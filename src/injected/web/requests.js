import bridge from './bridge';

const idMap = createNullObj();

bridge.addHandlers({
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (req) callback(req, msg);
  },
});

export function onRequestCreate(opts, context, fileName) {
  if (!opts.url) throw new SafeError('Required parameter "url" is missing.');
  const scriptId = context.id;
  const id = safeGetUniqId(`VMxhr${scriptId}`);
  const req = {
    __proto__: null,
    id,
    scriptId,
    opts,
  };
  start(req, context, fileName);
  return {
    abort() {
      bridge.post('AbortRequest', id, context);
    },
  };
}

function parseData(req, msg) {
  let res = req.raw;
  switch (req.opts.responseType) {
  case 'json':
    res = jsonParse(res);
    break;
  case 'document':
    res = new SafeDOMParser()::parseFromString(res, getContentType(msg) || 'text/html');
    break;
  default:
  }
  // `response` is sent only when changed so we need to remember it for response-less events
  req.response = res;
  // `raw` is decoded once per `response` change so we reuse the result just like native XHR
  delete req.raw;
  return res;
}

/**
 * Not using RegExp because it internally depends on proto stuff that can be easily broken,
 * and safe-guarding all of it is ridiculously disproportional.
 */
function getContentType(msg) {
  const type = msg.contentType || '';
  const len = type.length;
  let i = 0;
  let c;
  // Cutting everything after , or ; or whitespace
  while (i < len && (c = type[i]) !== ',' && c !== ';' && c > ' ') {
    i += 1;
  }
  return type::slice(0, i);
}

// request object functions
function callback(req, msg) {
  const { opts } = req;
  const cb = opts[`on${msg.type}`];
  if (cb) {
    const { data } = msg;
    const {
      response,
      responseHeaders: headers,
      responseText: text,
    } = data;
    if (response && !('raw' in req)) {
      req.raw = response;
    }
    defineProperty(data, 'response', {
      __proto__: null,
      get() {
        const value = 'raw' in req ? parseData(req, msg) : req.response;
        defineProperty(this, 'response', { __proto__: null, value });
        return value;
      },
    });
    if (headers != null) req.headers = headers;
    if (text != null) req.text = getOwnProp(text, 0) === 'same' ? response : text;
    setOwnProp(data, 'context', opts.context);
    setOwnProp(data, 'responseHeaders', req.headers);
    setOwnProp(data, 'responseText', req.text);
    cb(data);
  }
  if (msg.type === 'loadend') delete idMap[req.id];
}

function start(req, context, fileName) {
  const { id, scriptId } = req;
  const opts = assign(createNullObj(), req.opts);
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { data, withCredentials = true, anonymous = !withCredentials } = opts;
  idMap[id] = req;
  bridge.post('HttpRequest', {
    __proto__: null,
    id,
    scriptId,
    anonymous,
    fileName,
    data: data == null && []
      // `binary` is for TM/GM-compatibility + non-objects = must use a string `data`
      || (opts.binary || !isObject(data)) && [`${data}`]
      // FF56+ can send any cloneable data directly, FF52-55 can't due to https://bugzil.la/1371246
      || IS_FIREFOX && bridge.ua.browserVersion >= 56 && [data]
      /* Chrome can't directly transfer FormData to isolated world so we explode it,
       * trusting its iterator is usable because the only reason for a site to break it
       * is to fight a userscript, which it can do by breaking FormData constructor anyway */
      // eslint-disable-next-line no-restricted-syntax
      || (getObjectTypeTag(data) === 'FormData' ? [[...data], 'fd'] : [data, 'bin']),
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
    xhrType: getResponseType(opts.responseType),
  }::pickIntoThis(opts, [
    'headers',
    'method',
    'overrideMimeType',
    'password',
    'timeout',
    'url',
    'user',
  ]), context);
}

function getResponseType(responseType = '') {
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
