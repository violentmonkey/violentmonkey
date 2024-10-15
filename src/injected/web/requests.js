import bridge, { addHandlers } from './bridge';

/** @type {Object<string,GMReq.Web>} */
const idMap = createNullObj();
const kContentTextHtml = 'text/html';
const kResponse = 'response';
const kResponseXML = 'responseXML';
const kDocument = 'document';
const kRaw = 'raw';
const kOnerror = 'onerror';
const kOnload = 'onload';
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
const OPTS_TO_KEEP = [
  'context',
  kResponseType,
];
const OPTS_TO_PASS = [
  'headers',
  'method',
  'overrideMimeType',
  'password',
  'timeout',
  'user',
];
const PARSEABLE_TYPES = [
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/xml',
  kContentTextHtml,
];
/** truthy = preserve type (for binary mode), otherwise it's text mode by default */
const XHR_TYPES = {
  __proto__: null,
  arraybuffer: 1,
  blob: 1,
  json: 0,
  [kDocument]: 0,
  text: 0,
  '': 0,
};

addHandlers({
  /** @param {GMReq.Message.BG} msg */
  HttpRequested(msg) {
    const req = idMap[msg.id];
    if (!req) {
      return;
    }
    const { type } = msg;
    const cb = req.cb[type];
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
    } = data;
    let raw = req[kRaw];
    if (response != null) {
      if (req[kXhrType]) {
        req[kRaw] = response;
      } else {
        if (!raw) raw = req[kRaw] = [];
        if (isString(response)) {
          safePush(raw, response);
        } else {
          for (const chunk of response) safePush(raw, chunk);
        }
      }
    }
    if (req[kXhrType]) {
      setOwnProp(data, kResponseText, null);
    } else if (!raw || raw.length <= 1) {
      setOwnProp(data, kResponseText, raw && raw[0] || '');
    } else if (raw.length) {
      setOwnProp(data, kResponseText, safeBind(parseRaw, data, req, msg, kResponseText),
        true, 'get');
    }
    if (headers != null) {
      req[kResponseHeaders] = headers;
    }
    setOwnProp(data, 'context', req.context);
    setOwnProp(data, kResponseHeaders, req[kResponseHeaders]);
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
  const { [kResponseType]: responseType } = req;
  let res, ct, tmp;
  if (kRaw in req) {
    res = req[kRaw];
    if (!req[kXhrType]) {
      tmp = res;
      res = '';
      tmp::forEach(chunk => res += chunk);
      req[kRaw] = [res];
      req[kResponseText] = res;
    }
    if (responseType === kDocument && (ct = kContentTextHtml)
    || !responseType
      && propName === kResponseXML
      && PARSEABLE_TYPES::indexOf(ct = getContentType(msg) || kContentTextHtml) >= 0
    || responseType === 'json') {
      try { res = ct ? new SafeDOMParser()::parseFromString(res, ct) : jsonParse(res); }
      catch (e) { res = null; /* per specification */ }
    }
    if (responseType === kDocument) {
      const otherPropName = propName === kResponse ? kResponseXML : kResponse;
      setOwnProp(this, otherPropName, res);
      req[otherPropName] = res;
    }
    // TODO: should we implement this spec behavior?
    // if (propName === kResponseXML && responseType && responseType !== kDocument) {
    //   throw new SafeError('responseXML failed: responseType must be "document" or "" or absent.');
    // }
    if (responseType) {
      delete req[kRaw];
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
 * @return {VMScriptXHRControl | Promise<VMScriptXHRControl>}
 */
export function onRequestCreate(opts, context, fileName) {
  if (process.env.DEBUG) throwIfProtoPresent(opts);
  let { data, url, [kResponseType]: type = '' } = opts;
  let err, res;
  // XHR spec requires `url` but allows ''/null/non-string
  if (!url && !('url' in opts)) {
    err = new SafeError('Required parameter "url" is missing.');
  } else if (!isString(url)) {
    if (url === location) { url = url.href; } // safe window.location is unforgeable
    else {
      try { url = url::URLToString(); } // safe window.URL getter
      catch (e) {
        try { url = `${url}`; } // unsafe toString may throw e.g. for Symbol or if spoofed
        catch (e2) { err = e2; }
      }
    }
    opts.url = url;
  }
  if (err) {
    onRequestInitError(opts, err);
    return; // not returning the abort controller as there's no request to abort
  }
  if (!(type in XHR_TYPES)) {
    logging.warn(`Unknown ${kResponseType} "${type}"`);
    type = '';
  }
  const scriptId = context.id;
  const id = safeGetUniqId('VMxhr');
  const cb = createNullObj();
  const req = safePickInto({ cb, id, scriptId }, opts, OPTS_TO_KEEP);
  // withCredentials is for GM4 compatibility and used only if `anonymous` is not set,
  // it's true by default per the standard/historical behavior of gmxhr
  const { withCredentials = true, anonymous = !withCredentials } = opts;
  // setting opts.onload and onerror before EVENTS_TO_NOTIFY
  if (context.async) res = new SafePromise((resolve, reject) => {
    const { [kOnload]: onload, [kOnerror]: onerror } = opts;
    opts[kOnload] = onload ? v => { resolve(v); onload(v); } : resolve;
    opts[kOnerror] = onerror ? v => { reject(v); onerror(v); } : reject;
  });
  idMap[id] = req;
  data = data == null && []
    // `binary` is for TM/GM-compatibility + non-objects = must use a string `data`
    || (opts.binary || !isObject(data)) && [`${data}`]
    // No browser can send FormData/URLSearchParams directly across worlds
    || getFormData(data)
    // FF56+ can send any cloneable data directly, FF52-55 can't due to https://bugzil.la/1371246
    || IS_FIREFOX >= 56 && [data]
    || [data, 'bin'];
  /** @type {GMReq.Message.Web} */
  bridge.call('HttpRequest', safePickInto({
    anonymous,
    data,
    id,
    scriptId,
    url,
    [kFileName]: fileName,
    [kResponseType]: type,
    [kXhrType]: req[kXhrType] = XHR_TYPES[type] ? type : '',
    events: EVENTS_TO_NOTIFY::filter(key => isFunction(cb[key] = opts[`on${key}`])),
  }, opts, OPTS_TO_PASS));
  if (!res) res = {};
  else if (IS_FIREFOX) setPrototypeOf(res, SafePromiseConstructor);
  setOwnProp(res, 'abort', () => bridge.post('AbortRequest', id));
  return res;
}

export function onRequestInitError({ [kOnerror]: onerror }, err) {
  if (isFunction(onerror)) onerror(err);
  else throw err;
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
  try {
    return [data::urlSearchParamsToString(), 'usp'];
  } catch (e) {
    /**/
  }
}
