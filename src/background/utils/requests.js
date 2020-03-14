import { buffer2string, getUniqId, request, i18n, isEmpty, noop, sendTabCmd } from '#/common';
import { forEachEntry, objectPick } from '#/common/object';
import ua from '#/common/ua';
import cache from './cache';
import { isUserScript, parseMeta } from './script';
import { getScriptById } from './db';
import { extensionRoot } from './init';
import { commands } from './message';

const VM_VERIFY = 'VM-Verify';
const requests = {};
const verify = {};

Object.assign(commands, {
  ConfirmInstall: confirmInstall,
  /** @return {string} */
  GetRequestId(eventsToNotify = []) {
    const id = getUniqId();
    requests[id] = {
      id,
      eventsToNotify,
      xhr: new XMLHttpRequest(),
    };
    return id;
  },
  /** @return {void} */
  HttpRequest(details, src) {
    const { tab, frameId } = src;
    httpRequest(details, src, res => (
      sendTabCmd(tab.id, 'HttpRequested', res, { frameId })
    ));
  },
  /** @return {void} */
  AbortRequest(id) {
    const req = requests[id];
    if (req) {
      req.xhr.abort();
      clearRequest(req);
    }
  },
});

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
  const isNotCookie = header => !/^cookie2?$/i.test(header.name);
  const isNotSetCookie = header => !/^set-cookie2?$/i.test(header.name);
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
      options: ['responseHeaders', 'blocking', ...EXTRA_HEADERS],
      /** @param {chrome.webRequest.WebRequestHeadersDetails} details */
      listener({ responseHeaders: headers, requestId }) {
        const req = requests[verify[requestId]];
        if (req) {
          const oldLength = headers.length;
          if (req.anonymous) headers = headers.filter(isNotSetCookie);
          // mimic https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/getAllResponseHeaders
          req.responseHeaders = headers
          .map(({ name, value }) => `${name}: ${value}\r\n`)
          .sort()
          .join('');
          if (headers.length < oldLength) return { responseHeaders: headers };
        }
      },
    },
  };
  return {
    add(reqId, headers) {
      // need to set the entry even if it's empty [] so that 'if' check in del() runs only once
      headersToInject[reqId] = headers;
      // need the listener to get the requestId
      apiEvents::forEachEntry(([name, { listener, options }]) => {
        browser.webRequest[name].addListener(listener, apiFilter, options);
      });
    },
    del(reqId) {
      if (reqId in headersToInject) {
        delete headersToInject[reqId];
        if (isEmpty(headersToInject)) {
          apiEvents::forEachEntry(([name, { listener }]) => {
            browser.webRequest[name].removeListener(listener);
          });
        }
      }
    },
  };
})();

const CHUNK_SIZE = 30e6;

function getChunk(response, index) {
  return buffer2string(response, index * CHUNK_SIZE, CHUNK_SIZE);
}

function getResponseText(xhr) {
  try {
    return xhr.responseText;
  } catch (e) {
    // ignore if responseText is unreachable
  }
}

function xhrCallbackWrapper(req) {
  let lastPromise = Promise.resolve();
  let bufferSent;
  let contentType;
  let numChunks;
  const { id, isBuffer, xhr } = req;
  const chainedCallback = (msg) => {
    lastPromise = lastPromise.then(() => req.cb(msg));
  };
  return (evt) => {
    if (evt.type === 'loadend') clearRequest(req);
    if (!req.cb) return;
    const { response } = xhr;
    if (isBuffer && response && !numChunks) {
      numChunks = Math.ceil(response.byteLength / CHUNK_SIZE) || 1;
    }
    chainedCallback({
      id,
      numChunks,
      contentType: contentType
        || (contentType = xhr.getResponseHeader('Content-Type') || 'application/octet-stream'),
      data: !req.eventsToNotify.includes(evt.type) ? {} : {
        finalUrl: xhr.responseURL,
        readyState: xhr.readyState,
        responseHeaders: req.responseHeaders || xhr.getAllResponseHeaders(),
        status: xhr.status,
        statusText: xhr.statusText,
        response: numChunks && !bufferSent ? getChunk(response, 0) : response,
        responseText: getResponseText(xhr),
        ...('loaded' in evt) && objectPick(evt, ['lengthComputable', 'loaded', 'total']),
      },
      type: evt.type,
    });
    if (!bufferSent) {
      bufferSent = !!numChunks;
      for (let i = 1; i < numChunks; i += 1) {
        chainedCallback({
          id,
          chunk: getChunk(response, i),
          isLastChunk: i === numChunks - 1,
        });
      }
    }
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
async function httpRequest(details, src, cb) {
  const {
    anonymous, data, headers, id, isBuffer, method,
    overrideMimeType, password, timeout, url, user,
  } = details;
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req.anonymous = anonymous;
  req.isBuffer = isBuffer;
  const { xhr } = req;
  try {
    const vmHeaders = [];
    // Firefox doesn't send cookies,
    // https://github.com/violentmonkey/violentmonkey/issues/606
    let shouldSendCookies = ua.isFirefox && !anonymous;
    xhr.open(method, url, true, user || '', password || '');
    xhr.setRequestHeader(VM_VERIFY, id);
    if (headers) {
      headers::forEachEntry(([name, value]) => {
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
    if (isBuffer) xhr.responseType = 'arraybuffer';
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
    req.eventsToNotify.forEach(evt => { xhr[`on${evt}`] = callback; });
    xhr.onloadend = callback; // always send it for the internal cleanup
    const body = data ? decodeBody(data) : null;
    HeaderInjector.add(id, vmHeaders);
    xhr.send(body);
  } catch (e) {
    const { scriptId } = req;
    console.warn(e, `in script id ${scriptId}, ${getScriptById(scriptId).meta.name}`);
  }
}

function clearRequest(req) {
  if (req.coreId) delete verify[req.coreId];
  delete requests[req.id];
  HeaderInjector.del(req.id);
}

function decodeBody(obj) {
  const { cls, value } = obj;
  if (cls === 'formdata') {
    const result = new FormData();
    if (value) {
      value::forEachEntry(([key, items]) => {
        items.forEach((item) => {
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

async function confirmInstall({ code, from, url }, { tab = {} }) {
  if (!code) code = (await request(url)).data;
  // TODO: display the error in UI
  if (!isUserScript(code)) throw i18n('msgInvalidScript');
  cache.put(url, code, 3000);
  const confirmKey = getUniqId();
  const tabId = tab.id;
  cache.put(`confirm-${confirmKey}`, { url, from, tabId });
  browser.tabs.create({
    url: `/confirm/index.html#${confirmKey}`,
    index: tab.index + 1 || undefined,
    active: !!tab.active,
    ...tabId >= 0 && ua.openerTabIdSupported ? { openerTabId: tabId } : {},
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

browser.tabs.onCreated.addListener((tab) => {
  // FF 68+ can't read file URLs directly so we need to keep the tab open
  if (/\.user\.js([?#]|$)/.test(tab.pendingUrl || tab.url)
  && !(ua.isFirefox >= 68 && tab.url.startsWith('file:'))) {
    cache.put(`autoclose:${tab.id}`, true, 10e3);
  }
});

browser.webRequest.onBeforeRequest.addListener((req) => {
  const { method, tabId, url } = req;
  if (method !== 'GET') {
    return;
  }
  // open a real URL for simplified userscript URL listed in devtools of the web page
  if (url.startsWith(extensionRoot)) {
    const id = +url.split('#').pop();
    const redirectUrl = `${extensionRoot}options/index.html#scripts/${id}`;
    return { redirectUrl };
  }
  if (!cache.has(`bypass:${url}`)
  && (!blacklist.some(matches, url) || whitelist.some(matches, url))) {
    maybeInstallUserJs(tabId, url);
    return { redirectUrl: 'javascript:void 0' }; // eslint-disable-line no-script-url
  }
}, {
  urls: [
    // 1. *:// comprises only http/https
    // 2. the API ignores #hash part
    // 3. Firefox: onBeforeRequest does not work with file:// or moz-extension://
    '*://*/*.user.js',
    '*://*/*.user.js?*',
    'file://*/*.user.js',
    'file://*/*.user.js?*',
    `${extensionRoot}*.user.js`,
  ],
  types: ['main_frame'],
}, ['blocking']);

async function maybeInstallUserJs(tabId, url) {
  const { data: code } = await request(url).catch(noop) || {};
  if (parseMeta(code).name) {
    const tab = tabId >= 0 && await browser.tabs.get(tabId) || {};
    confirmInstall({ code, url, from: tab.url }, { tab });
    if (cache.has(`autoclose:${tabId}`)
    || tab.pendingUrl && tab.url === 'chrome://newtab/') {
      browser.tabs.remove(tabId);
    }
  } else {
    cache.put(`bypass:${url}`, true, 10e3);
    if (tabId >= 0) browser.tabs.update(tabId, { url });
  }
}

/** @this {string} */
function matches(re) {
  return re.test(this);
}
