import { includes, encodeBody } from './helpers';
import bridge from './bridge';

const map = {};
const queue = [];

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
  start(req, id);
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
      let data = response.split(',');
      const matches = data[0].match(/^data:(.*?);base64$/);
      if (!matches) {
        // invalid
        req.data.response = null;
      } else {
        data = window.atob(data[1]);
        const arr = new window.Uint8Array(data.length);
        for (let i = 0; i < data.length; i += 1) arr[i] = data.charCodeAt(i);
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
    return JSON.parse(req.data.response);
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
      res.data.response = req.data[0];
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
    method: details.method,
    url: details.url,
    user: details.user,
    password: details.password,
    headers: details.headers,
    overrideMimeType: details.overrideMimeType,
  };
  req.id = id;
  map[id] = req;
  if (includes(['arraybuffer', 'blob'], details.responseType)) {
    payload.responseType = 'arraybuffer';
  }
  encodeBody(details.data)
  .then(body => {
    payload.data = body;
    bridge.post({
      cmd: 'HttpRequest',
      data: payload,
    });
  });
}

function getFullUrl(url) {
  const a = document.createElement('a');
  a.setAttribute('href', url);
  return a.href;
}
