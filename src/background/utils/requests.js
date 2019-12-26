import {
  getUniqId, request, i18n, buffer2string, isEmpty,
} from '#/common';
import ua from '#/common/ua';
import cache from './cache';
import { isUserScript, parseMeta } from './script';
import { getScriptByIdSync } from './db';

const VM_VERIFY = 'VM-Verify';
const requests = {};
const verify = {};
const specialHeaders = [
  'user-agent',
  // https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
  // https://cs.chromium.org/?q=file:cc+symbol:IsForbiddenHeader%5Cb
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
];
// const tasks = {};
const HeaderInjector = (() => {
  /** @type chrome.webRequest.RequestFilter */
  const apiFilter = {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest'],
    // -1 is browser.tabs.TAB_ID_NONE to limit the listener to requests from the bg script
    tabId: -1,
  };
  const EXTRA_HEADERS = [
    browser.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS,
  ].filter(Boolean);
  const headersToInject = {};
  /** @param {chrome.webRequest.HttpHeader} header */
  const isVmVerify = header => header.name === VM_VERIFY;
  const isNotCookie = header => !/^cookie$/i.test(header.name);
  const isSendable = header => header.name !== VM_VERIFY;
  const isSendableAnon = header => isSendable(header) && isNotCookie(header);
  const apiEvents = {
    onBeforeSendHeaders: {
      options: ['requestHeaders', 'blocking', ...EXTRA_HEADERS],
      /** @param {chrome.webRequest.WebRequestHeadersDetails} details */
      listener({ requestHeaders: headers, requestId }) {
        // only the first call during a redirect/auth chain will have VM-Verify header
        const reqId = headers.find(isVmVerify)?.value || verify[requestId];
        const req = reqId && requests[reqId];
        if (reqId && req) {
          verify[requestId] = reqId;
          req.coreId = requestId;
          headers = (req.noNativeCookie ? headers.filter(isNotCookie) : headers)
          .concat(headersToInject[reqId] || [])
          .filter(req.anonymous ? isSendableAnon : isSendable);
        }
        return { requestHeaders: headers };
      },
    },
    onHeadersReceived: {
      options: ['responseHeaders', ...EXTRA_HEADERS],
      /** @param {chrome.webRequest.WebRequestHeadersDetails} details */
      listener({ responseHeaders, requestId }) {
        const req = requests[verify[requestId]];
        if (req) {
          // mimic https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/getAllResponseHeaders
          req.responseHeaders = responseHeaders
          .map(({ name, value }) => `${name}: ${value}\r\n`)
          .sort()
          .join('');
        }
      },
    },
  };
  return {
    add(reqId, headers) {
      // need to set the entry even if it's empty [] so that 'if' check in del() runs only once
      headersToInject[reqId] = headers;
      // need the listener to get the requestId
      Object.entries(apiEvents).forEach(([name, { listener, options }]) => {
        browser.webRequest[name].addListener(listener, apiFilter, options);
      });
    },
    del(reqId) {
      if (reqId in headersToInject) {
        delete headersToInject[reqId];
        if (isEmpty(headersToInject)) {
          Object.entries(apiEvents).forEach(([name, { listener }]) => {
            browser.webRequest[name].removeListener(listener);
          });
        }
      }
    },
  };
})();

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
  return (evt) => {
    const res = {
      id: req.id,
      type: evt.type,
      resType: xhr.responseType,
      contentType: xhr.getResponseHeader('Content-Type') || 'application/octet-stream',
    };
    const data = {
      finalUrl: xhr.responseURL,
      readyState: xhr.readyState,
      responseHeaders: req.responseHeaders || xhr.getAllResponseHeaders(),
      status: xhr.status,
      statusText: xhr.statusText,
    };
    res.data = data;
    try {
      data.responseText = xhr.responseText;
    } catch (e) {
      // ignore if responseText is unreachable
    }
    if (evt.type === 'progress') {
      ['lengthComputable', 'loaded', 'total'].forEach((key) => {
        data[key] = evt[key];
      });
    }
    if (evt.type === 'loadend') clearRequest(req);
    else if (xhr.readyState >= XMLHttpRequest.LOADING) HeaderInjector.del(req.id);
    lastPromise = lastPromise.then(() => {
      data.response = xhr.response && xhr.responseType === 'arraybuffer'
        ? buffer2string(xhr.response)
        : xhr.response;
      if (req.cb) req.cb(res);
    });
  };
}

function isSpecialHeader(lowerHeader) {
  return specialHeaders.includes(lowerHeader)
    || lowerHeader.startsWith('proxy-')
    || lowerHeader.startsWith('sec-');
}

/**
 * @param {Object} details
 * @param {chrome.runtime.MessageSender} src
 * @param {function} cb
 */
export async function httpRequest(details, src, cb) {
  const {
    anonymous, data, headers, id, method,
    overrideMimeType, password, responseType,
    timeout, url, user, withCredentials,
  } = details;
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req.anonymous = anonymous;
  const { xhr } = req;
  try {
    const vmHeaders = [];
    // Firefox doesn't send cookies,
    // https://github.com/violentmonkey/violentmonkey/issues/606
    let shouldSendCookies = ua.isFirefox && !anonymous && (
      withCredentials || new URL(url).origin === new URL(src.url).origin
    );
    xhr.open(method, url, true, user || '', password || '');
    xhr.setRequestHeader(VM_VERIFY, id);
    if (headers) {
      Object.entries(headers).forEach(([name, value]) => {
        const lowerName = name.toLowerCase();
        if (isSpecialHeader(lowerName)) {
          vmHeaders.push({ name, value });
        } else if (!lowerName.startsWith('vm-')) {
          // `VM-` headers are reserved
          xhr.setRequestHeader(name, value);
        }
        if (lowerName === 'cookie') {
          shouldSendCookies = false;
        }
      });
    }
    if (timeout) xhr.timeout = timeout;
    if (responseType) xhr.responseType = 'arraybuffer';
    if (overrideMimeType) xhr.overrideMimeType(overrideMimeType);
    if (shouldSendCookies) {
      const cookies = await browser.cookies.getAll({
        url,
        storeId: src.tab.cookieStoreId,
        ...ua.isFirefox >= 59 && { firstPartyDomain: null },
      });
      if (cookies.length) {
        req.noNativeCookie = true;
        vmHeaders.push({
          name: 'cookie',
          value: cookies.map(c => `${c.name}=${c.value};`).join(' '),
        });
      }
    }
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
    .forEach((evt) => { xhr[`on${evt}`] = callback; });
    const body = data ? decodeBody(data) : null;
    HeaderInjector.add(id, vmHeaders);
    xhr.send(body);
  } catch (e) {
    const { scriptId } = req;
    console.warn(e, `in script id ${scriptId}, ${getScriptByIdSync(scriptId).meta.name}`);
  }
}

function clearRequest(req) {
  if (req.coreId) delete verify[req.coreId];
  delete requests[req.id];
  HeaderInjector.del(req.id);
}

export function abortRequest(id) {
  const req = requests[id];
  if (req) {
    req.xhr.abort();
    clearRequest(req);
  }
}

function decodeBody(obj) {
  const { cls, value } = obj;
  if (cls === 'formdata') {
    const result = new FormData();
    if (value) {
      Object.keys(value).forEach((key) => {
        value[key].forEach((item) => {
          result.append(key, decodeBody(item));
        });
      });
    }
    return result;
  }
  if (['blob', 'file'].includes(cls)) {
    const { type, name, lastModified } = obj;
    const array = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) array[i] = value.charCodeAt(i);
    const data = [array.buffer];
    if (cls === 'file') return new File(data, name, { type, lastModified });
    return new Blob(data, { type });
  }
  if (value) return JSON.parse(value);
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

export async function confirmInstall(info, src = {}) {
  const { url, from } = info;
  const code = info.code || (await request(url)).data;
  // TODO: display the error in UI
  if (!isUserScript(code)) throw i18n('msgInvalidScript');
  cache.put(url, code, 3000);
  const confirmKey = getUniqId();
  cache.put(`confirm-${confirmKey}`, { url, from });
  browser.tabs.create({
    url: `/confirm/index.html#${confirmKey}`,
    index: src.tab ? src.tab.index + 1 : undefined,
    ...src.tab && ua.openerTabIdSupported ? { openerTabId: src.tab.id } : {},
  });
}

const whitelist = [
  '^https://greasyfork.org/scripts/[^/]*/code/[^/]*?\\.user\\.js([?#]|$)',
  '^https://openuserjs.org/install/[^/]*/[^/]*?\\.user\\.js([?#]|$)',
  '^https://github.com/[^/]*/[^/]*/raw/[^/]*/[^/]*?\\.user\\.js([?#]|$)',
  '^https://gist.github.com/.*?/[^/]*?.user.js([?#]|$)',
].map(re => new RegExp(re));
const blacklist = [
  '//(?:(?:gist.|)github.com|greasyfork.org|openuserjs.org)/',
].map(re => new RegExp(re));
const bypass = {};
const extensionRoot = browser.runtime.getURL('/');

browser.tabs.onCreated.addListener((tab) => {
  if (/\.user\.js([?#]|$)/.test(tab.pendingUrl || tab.url)) {
    cache.put(`autoclose:${tab.id}`, true, 1000);
  }
});

browser.webRequest.onBeforeRequest.addListener((req) => {
  // onBeforeRequest fired for `file:`
  // - works on Chrome
  // - does not work on Firefox
  const { url } = req;
  if (req.method === 'GET') {
    // open a real URL for simplified userscript URL listed in devtools of the web page
    if (url.startsWith(extensionRoot)) {
      const id = +url.split('#').pop();
      const redirectUrl = `${extensionRoot}options/index.html#scripts/${id}`;
      return { redirectUrl };
    }
    if (!bypass[url] && (
      whitelist.some(re => re.test(url)) || !blacklist.some(re => re.test(url))
    )) {
      Promise.all([
        request(url).catch(() => ({ data: '' })),
        req.tabId < 0 ? Promise.resolve() : browser.tabs.get(req.tabId),
      ])
      .then(([{ data: code }, tab]) => {
        const meta = parseMeta(code);
        if (meta.name) {
          confirmInstall({
            code,
            url,
            // Chrome 79+ uses pendingUrl while the tab connects to the newly navigated URL
            from: tab && (tab.pendingUrl || tab.url),
          }, { tab });
          if (cache.has(`autoclose:${req.tabId}`)) {
            browser.tabs.remove(req.tabId);
          }
        } else {
          if (!bypass[url]) {
            bypass[url] = {
              timer: setTimeout(() => {
                delete bypass[url];
              }, 10000),
            };
          }
          if (tab && tab.id) {
            browser.tabs.update(tab.id, { url });
          }
        }
      });
      // { cancel: true } will redirect to a blocked view
      return { redirectUrl: 'javascript:history.back()' }; // eslint-disable-line no-script-url
    }
  }
}, {
  urls: [
    // 1. *:// comprises only http/https
    // 2. the API ignores #hash part
    '*://*/*.user.js',
    '*://*/*.user.js?*',
    'file://*/*.user.js',
    'file://*/*.user.js?*',
    `${extensionRoot}*.user.js`,
  ],
  types: ['main_frame'],
}, ['blocking']);
