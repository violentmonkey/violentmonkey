import { getUniqId } from 'src/common';
import cache from './cache';

const requests = {};
const verify = {};
const specialHeaders = [
  'user-agent',
  'referer',
  'origin',
  'host',
  'cookie',
];
// const tasks = {};

export function getRequestId() {
  const id = getUniqId();
  requests[id] = {
    id,
    xhr: new XMLHttpRequest(),
  };
  return id;
}

function xhrCallbackWrapper(req) {
  let lastPromise = Promise.resolve();
  const { xhr } = req;
  return evt => {
    const res = {
      id: req.id,
      type: evt.type,
      resType: xhr.responseType,
    };
    const data = {
      finalUrl: xhr.responseURL,
      readyState: xhr.readyState,
      responseHeaders: xhr.getAllResponseHeaders(),
      status: xhr.status,
      statusText: xhr.statusText,
    };
    res.data = data;
    try {
      data.responseText = xhr.responseText;
    } catch (e) {
      // ignore if responseText is unreachable
    }
    if (evt.type === 'loadend') clearRequest(req);
    lastPromise = lastPromise.then(() => new Promise(resolve => {
      if (xhr.response && xhr.responseType === 'blob') {
        const reader = new FileReader();
        reader.onload = () => {
          data.response = reader.result;
          resolve();
        };
        reader.readAsDataURL(xhr.response);
      } else {
        // default `null` for blob and '' for text
        data.response = xhr.response;
        resolve();
      }
    }))
    .then(() => {
      if (req.cb) req.cb(res);
    });
  };
}

export function httpRequest(details, cb) {
  const req = requests[details.id];
  if (!req || req.cb) return;
  req.cb = cb;
  const { xhr } = req;
  try {
    xhr.open(details.method, details.url, true, details.user, details.password);
    xhr.setRequestHeader('VM-Verify', details.id);
    if (details.headers) {
      Object.keys(details.headers).forEach(key => {
        const lowerKey = key.toLowerCase();
        // `VM-` headers are reserved
        if (lowerKey.startsWith('vm-')) return;
        xhr.setRequestHeader(
          specialHeaders.includes(lowerKey) ? `VM-${key}` : key,
          details.headers[key],
        );
      });
    }
    if (details.responseType) xhr.responseType = 'blob';
    if (details.overrideMimeType) xhr.overrideMimeType(details.overrideMimeType);
    const callback = xhrCallbackWrapper(req);
    [
      'abort',
      'error',
      'load',
      'loadend',
      'progress',
      'readystatechange',
      'timeout',
    ]
    .forEach(evt => { xhr[`on${evt}`] = callback; });
    // req.finalUrl = details.url;
    xhr.send(details.data);
  } catch (e) {
    console.warn(e);
  }
}

function clearRequest(req) {
  if (req.coreId) delete verify[req.coreId];
  delete requests[req.id];
}

export function abortRequest(id) {
  const req = requests[id];
  if (req) {
    req.xhr.abort();
    clearRequest(req);
  }
}

// Watch URL redirects
// browser.webRequest.onBeforeRedirect.addListener(details => {
//   const reqId = verify[details.requestId];
//   if (reqId) {
//     const req = requests[reqId];
//     if (req) req.finalUrl = details.redirectUrl;
//   }
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// });

// Modifications on headers
browser.webRequest.onBeforeSendHeaders.addListener(details => {
  const headers = details.requestHeaders;
  const newHeaders = [];
  const vmHeaders = {};
  headers.forEach(header => {
    // if (header.name === 'VM-Task') {
    //   tasks[details.requestId] = header.value;
    // } else
    if (header.name.startsWith('VM-')) {
      vmHeaders[header.name.slice(3)] = header.value;
    } else {
      newHeaders.push(header);
    }
  });
  const reqId = vmHeaders.Verify;
  if (reqId) {
    const req = requests[reqId];
    if (req) {
      delete vmHeaders.Verify;
      verify[details.requestId] = reqId;
      req.coreId = details.requestId;
      Object.keys(vmHeaders).forEach(name => {
        if (specialHeaders.includes(name.toLowerCase())) {
          newHeaders.push({ name, value: vmHeaders[name] });
        }
      });
    }
  }
  return { requestHeaders: newHeaders };
}, {
  urls: ['<all_urls>'],
  types: ['xmlhttprequest'],
}, ['blocking', 'requestHeaders']);

// tasks are not necessary now, turned off
// Stop redirects
// browser.webRequest.onHeadersReceived.addListener(details => {
//   const task = tasks[details.requestId];
//   if (task) {
//     delete tasks[details.requestId];
//     if (task === 'Get-Location' && [301, 302, 303].includes(details.statusCode)) {
//       const locationHeader = details.responseHeaders.find(
//         header => header.name.toLowerCase() === 'location');
//       const base64 = locationHeader && locationHeader.value;
//       return {
//         redirectUrl: `data:text/plain;charset=utf-8,${base64 || ''}`,
//       };
//     }
//   }
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// }, ['blocking', 'responseHeaders']);
// browser.webRequest.onCompleted.addListener(details => {
//   delete tasks[details.requestId];
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// });
// browser.webRequest.onErrorOccurred.addListener(details => {
//   delete tasks[details.requestId];
// }, {
//   urls: ['<all_urls>'],
//   types: ['xmlhttprequest'],
// });

browser.webRequest.onBeforeRequest.addListener(req => {
  // onBeforeRequest is fired for local files too
  if (req.method === 'GET' && /\.user\.js([?#]|$)/.test(req.url)) {
    // {cancel: true} will redirect to a blocked view
    const noredirect = { redirectUrl: 'javascript:history.back()' };  // eslint-disable-line no-script-url
    const x = new XMLHttpRequest();
    x.open('GET', req.url, false);
    try {
      x.send();
    } catch (e) {
      // Request is redirected
      return;
    }
    if ((!x.status || x.status === 200) && !/^\s*</.test(x.responseText)) {
      cache.put(req.url, x.responseText, 3000);
      const confirmInfo = {
        url: req.url,
      };
      const confirmKey = getUniqId();
      // Firefox: slashes are decoded automatically by Firefox, thus cannot be
      // used as separators
      const optionsURL = browser.runtime.getURL(browser.runtime.getManifest().options_page);
      const url = `${optionsURL}#confirm?id=${confirmKey}`;
      (req.tabId < 0 ? Promise.resolve() : browser.tabs.get(req.tabId))
      .then(tab => {
        confirmInfo.from = tab && tab.url;
        cache.put(`confirm-${confirmKey}`, confirmInfo);
        browser.tabs.create({ url });
      });
      return noredirect;
    }
  }
}, {
  urls: ['<all_urls>'],
  types: ['main_frame'],
}, ['blocking']);
