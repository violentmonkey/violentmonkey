import bridge, { addHandlers } from './bridge';

/** @type {Object<string,GMReq.Web>} */
const idMap = createNullObj();
const kResponse = 'response';
const kResponseHeaders = 'responseHeaders';
const kResponseText = 'responseText';
const kResponseType = 'responseType';
const kResponseXML = 'responseXML';
const kDocument = 'document';
const EVENTS_TO_NOTIFY = [
  'abort',
  'error',
  'load',
  'loadend',
  'loadstart',
  'progress',
  'readystatechange',
  'timeout',
];
const OPTS_TO_PASS = [
  'headers',
  'method',
  'overrideMimeType',
  'password',
  'timeout',
  'user',
];

addHandlers({
  /** @param {GMReq.Message.BG} msg */
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (!req) {
      return;
    }
    const { type } = msg;
    const { opts } = req;
    const cb = opts[`on${type}`];
    if (type === 'loadend') {
      delete idMap[req.id];
    }
    if (!cb) {
      return;
    }
    if (hasOwnProperty(msg, 'error')) {
      cb(new SafeError((/** @type {BGError} */msg).error));
      return;
    }
    const { data } = msg;
    const {
      [kResponse]: response,
      [kResponseHeaders]: headers,
      [kResponseText]: text,
    } = data;
    if (response != null || data.readyState === 4) {
      req.raw = response;
    }
    if (headers != null) {
      req[kResponseHeaders] = headers;
    }
    if (text != null) {
      req[kResponseText] = getOwnProp(text, 0) === 'same' ? response : text;
    }
    setOwnProp(data, 'context', opts.context);
    setOwnProp(data, kResponseHeaders, req[kResponseHeaders]);
    setOwnProp(data, kResponseText, req[kResponseText]);
    setOwnProp(data, kResponseXML, safeBind(parseRaw, data, req, msg, kResponseXML), true, 'get');
    setOwnProp(data, kResponse, safeBind(parseRaw, data, req, msg, kResponse), true, 'get');
    cb(data);
  },
});

/**
 * `response` is sent only when changed so we need to remember it for response-less events
 * `raw` is decoded once per `response` change so we reuse the result just like native XHR
 * @this {VMScriptResponseObject}
 * @param {GMReq.Web} req
 * @param {GMReq.Message.BG} msg
 * @param {string} propName
 * @returns {string | Blob | ArrayBuffer | null}
 */
function parseRaw(req, msg, propName) {
  const { [kResponseType]: responseType } = req.opts;
  let res;
  if ('raw' in req) {
    res = req.raw;
    if (responseType === kDocument || !responseType && propName === kResponseXML) {
      res = new SafeDOMParser()::parseFromString(res, getContentType(msg) || 'text/html');
    } else if (responseType === 'json') {
      res = jsonParse(res);
    }
    if (responseType === kDocument) {
      const otherPropName = propName === kResponse ? kResponseXML : kResponse;
      setOwnProp(this, otherPropName, res);
      req[otherPropName] = res;
    }
    if (responseType) {
      delete req.raw;
    }
    req[propName] = res;
  } else {
    res = req[propName];
  }
  if (res === undefined) {
    res = null;
  }
  setOwnProp(this, propName, res);
  return res;
}

/**
 * @param {GMReq.UserOpts} opts - must already have a null proto
 * @param {GMContext} context
 * @param {string} fileName
 * @return {VMScriptXHRControl}
 */
export function onRequestCreate(opts, context, fileName) {
  if (process.env.DEBUG) throwIfProtoPresent(opts);
  let { data, url } = opts;
  let err, onerror;
  // XHR spec requires `url` but allows ''/null/non-string
  if (!url && !('url' in opts)) {
    err = new SafeError('Required parameter "url" is missing.');
  } else if (!isString(url)) {
    if (url === location) { url = url.href; } // safe window.location is unforgeable
    else {
      try { url = url::URLToString(); } // safe window.URL getter
      catch (e) {
        try { url = `${url}`; } // unsafe toString may throw e.g. for Symbol or if spoofed
        catch (e) { err = e; }
      }
    }
    if (!err) opts.url = url;
  }
  if (err) {
    if (isFunction(onerror = opts.onerror)) onerror(err);
    else throw err;
  }
  const scriptId = context.id;
  const id = safeGetUniqId('VMxhr');
  /** @type {GMReq.Web} */
  const req = {
    __proto__: null,
    id,
    scriptId,
    opts,
  };
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { withCredentials = true, anonymous = !withCredentials } = opts;
  idMap[id] = req;
  data = data == null && []
    // `binary` is for TM/GM-compatibility + non-objects = must use a string `data`
    || (opts.binary || !isObject(data)) && [`${data}`]
    // No browser can send FormData directly across worlds
    || getFormData(data)
    // FF56+ can send any cloneable data directly, FF52-55 can't due to https://bugzil.la/1371246
    || IS_FIREFOX >= 56 && [data]
    || [data, 'bin'];
  /** @type {GMReq.Message.Web} */
  bridge.call('HttpRequest', createNullObj({
    anonymous,
    data,
    fileName,
    id,
    scriptId,
    url,
    events: EVENTS_TO_NOTIFY::filter(key => isFunction(opts[`on${key}`])),
    xhrType: getResponseType(opts[kResponseType]),
  }, opts, OPTS_TO_PASS));
  return {
    abort() {
      bridge.post('AbortRequest', id);
    },
  };
}

/**
 * Not using RegExp because it internally depends on proto stuff that can be easily broken,
 * and safe-guarding all of it is ridiculously disproportional.
 * @param {GMReq.Message.BG} msg
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

/** Chrome/FF can't directly transfer FormData to isolated world so we explode it,
 * trusting its iterator is usable because the only reason for a site to break it
 * is to fight a userscript, which it can do by breaking FormData constructor anyway */
function getFormData(data) {
  try {
    return [[...data::formDataEntries()], 'fd']; // eslint-disable-line no-restricted-syntax
  } catch (e) {
    /**/
  }
}

function getResponseType(responseType = '') {
  switch (responseType) {
  case 'arraybuffer':
  case 'blob':
    return responseType;
  case kDocument:
  case 'json':
  case 'text':
  case '':
    break;
  default:
    log('warn', null, `Unknown ${kResponseType} "${responseType}",`
      + ' see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.');
  }
  return '';
}
