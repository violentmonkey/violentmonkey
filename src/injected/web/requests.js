import { includes, encodeBody, jsonLoad } from '../utils/helpers';
import bridge from './bridge';

const map = {};
const queue = [];

const NS_HTML = 'http://www.w3.org/1999/xhtml';

export function onRequestCreate(details) {
  const req = {
    details,
    req: {
      abort: reqAbort,
    },
  };
  details.url = getFullUrl(details.url);
  queue.push(req);
  bridge.post({ cmd: 'GetRequestId' });
  return req.req;
}

export function onRequestStart(id) {
  const req = queue.shift();
  if (req) start(req, id);
}

export function onRequestCallback(res) {
  const req = map[res.id];
  if (req) callback(req, res);
}

function reqAbort() {
  bridge.post({ cmd: 'AbortRequest', data: this.id });
}

function parseData(req, details) {
  if (req.resType) {
    // blob or arraybuffer
    const { response } = req.data;
    if (response) {
      const data = response.split(',');
      const matches = data[0].match(/^data:(.*?);base64$/);
      if (!matches) {
        // invalid
        req.data.response = null;
      } else {
        const raw = window.atob(data[1]);
        const arr = new window.Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
        if (details.responseType === 'blob') {
          // blob
          return new Blob([arr], { type: matches[1] });
        }
        // arraybuffer
        return arr.buffer;
      }
    }
  } else if (details.responseType === 'json') {
    // json
    return jsonLoad(req.data.response);
  } else {
    // text
    return req.data.response;
  }
}

// request object functions
function callback(req, res) {
  const cb = req.details[`on${res.type}`];
  if (cb) {
    if (res.data.response) {
      if (!req.data) req.data = [parseData(res, req.details)];
      [res.data.response] = req.data;
    }
    res.data.context = req.details.context;
    cb(res.data);
  }
  if (res.type === 'loadend') delete map[req.id];
}

function start(req, id) {
  const { details } = req;
  const payload = {
    id,
    anonymous: details.anonymous,
    method: details.method,
    url: details.url,
    user: details.user,
    password: details.password,
    headers: details.headers,
    timeout: details.timeout,
    overrideMimeType: details.overrideMimeType,
  };
  req.id = id;
  map[id] = req;
  const { responseType } = details;
  if (responseType) {
    if (includes(['arraybuffer', 'blob'], responseType)) {
      payload.responseType = 'arraybuffer';
    } else if (!includes(['json', 'text'], responseType)) {
      console.warn(`[Violentmonkey] Unknown responseType "${responseType}", see https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest for more detail.`);
    }
  }
  encodeBody(details.data)
  .then((body) => {
    payload.data = body;
    bridge.post({
      cmd: 'HttpRequest',
      data: payload,
    });
  });
}

function getFullUrl(url) {
  const a = document.createElementNS(NS_HTML, 'a');
  a.setAttribute('href', url);
  return a.href;
}
