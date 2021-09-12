import {
  blob2base64, buffer2string, getUniqId, request, i18n, isEmpty, noop, sendTabCmd,
  string2uint8array,
} from '#/common';
import { forEachEntry, objectPick } from '#/common/object';
import ua from '#/common/ua';
import cache from './cache';
import { isUserScript, parseMeta } from './script';
import { extensionRoot } from './init';
import { commands } from './message';

const VM_VERIFY = 'VM-Verify';
/** @type {Object<string,VMHttpRequest>} */
const requests = {};
const verify = {};
const tabRequests = {};
let encoder;

Object.assign(commands, {
  ConfirmInstall: confirmInstall,
  /** @return {string} */
  GetRequestId(eventsToNotify = [], src) {
    const id = getUniqId();
    const tabId = src.tab?.id;
    requests[id] = {
      id,
      tabId,
      eventsToNotify,
      xhr: new XMLHttpRequest(),
    };
    if (tabId) {
      let set = tabRequests[tabId];
      if (!set) {
        set = new Set();
        tabRequests[tabId] = set;
      }
      set.add(id);
    }
    return id;
  },
  /** @return {void} */
  HttpRequest(opts, src) {
    const { tab, frameId } = src;
    httpRequest(opts, src, res => (
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
  RevokeBlob(url) {
    const timer = cache.pop(`xhrBlob:${url}`);
    if (timer) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
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
  };
  const EXTRA_HEADERS = [
    browser.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS,
  ].filter(Boolean);
  const headersToInject = {};
  /** @param {chrome.webRequest.HttpHeader} header */
  const isVmVerify = header => header.name === VM_VERIFY;
  const isNotCookie = header => !/^cookie2?$/i.test(header.name);
  const isSendable = header => header.name !== VM_VERIFY;
  const isSendableAnon = header => isSendable(header) && isNotCookie(header);
  const RE_SET_COOKIE = /^set-cookie2?$/i;
  const RE_SET_COOKIE_VALUE = /^\s*(?:__(Secure|Host)-)?([^=\s]+)\s*=\s*(")?([!#-+\--:<-[\]-~]*)\3(.*)/;
  const RE_SET_COOKIE_ATTR = /\s*;?\s*(\w+)(?:=(")?([!#-+\--:<-[\]-~]*)\2)?/y;
  const SAME_SITE_MAP = {
    strict: 'strict',
    lax: 'lax',
    none: 'no_restriction',
  };
  /**
   * @param {string} headerValue
   * @param {VMHttpRequest} req
   * @param {string} url
   */
  const setCookieInStore = (headerValue, req, url) => {
    let m = RE_SET_COOKIE_VALUE.exec(headerValue);
    if (m) {
      const [, prefix, name, , value, optStr] = m;
      const opt = {};
      const isHost = prefix === 'Host';
      RE_SET_COOKIE_ATTR.lastIndex = 0;
      while ((m = RE_SET_COOKIE_ATTR.exec(optStr))) {
        opt[m[1].toLowerCase()] = m[3];
      }
      const sameSite = opt.sameSite?.toLowerCase();
      browser.cookies.set({
        url,
        name,
        value,
        domain: isHost ? undefined : opt.domain,
        expirationDate: Math.max(0, +new Date(opt['max-age'] * 1000 || opt.expires)) || undefined,
        httpOnly: 'httponly' in opt,
        path: isHost ? '/' : opt.path,
        sameSite: SAME_SITE_MAP[sameSite],
        secure: url.startsWith('https:') && (!!prefix || sameSite === 'none' || 'secure' in opt),
        storeId: req.storeId,
      });
    }
  };
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
      listener({ responseHeaders: headers, requestId, url }) {
        const req = requests[verify[requestId]];
        if (req) {
          if (req.anonymous || req.storeId) {
            headers = headers.filter(h => (
              !RE_SET_COOKIE.test(h.name)
              || !req.storeId
              || setCookieInStore(h.value, req, url)
            ));
          }
          req.responseHeaders = headers.map(encodeWebRequestHeader).join('');
          return { responseHeaders: headers };
        }
      },
    },
  };
  // Chrome 74-91 needs an extraHeaders listener at tab load start, https://crbug.com/1074282
  // We're attaching a no-op in non-blocking mode so it's very lightweight and fast.
  if (ua.isChrome >= 74 && ua.isChrome <= 91) {
    browser.webRequest.onBeforeSendHeaders.addListener(noop, apiFilter, ['extraHeaders']);
  }
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

const CHUNK_SIZE = 64e6 / 4;

async function blob2chunk(response, index) {
  return blob2base64(response, index * CHUNK_SIZE, CHUNK_SIZE);
}

function blob2objectUrl(response) {
  const url = URL.createObjectURL(response);
  cache.put(`xhrBlob:${url}`, setTimeout(commands.RevokeBlob, 60e3, url), 61e3);
  return url;
}

/** @param {VMHttpRequest} req */
function xhrCallbackWrapper(req) {
  let lastPromise = Promise.resolve();
  let contentType;
  let dataSize;
  let numChunks;
  let response;
  let responseText;
  let responseHeaders;
  let sent = false;
  const { id, blobbed, chunked, xhr } = req;
  // Chrome encodes messages to UTF8 so they can grow up to 4x but 64MB is the message size limit
  const getChunk = blobbed && blob2objectUrl || chunked && blob2chunk;
  const getResponseHeaders = () => {
    const headers = req.responseHeaders || xhr.getAllResponseHeaders();
    if (responseHeaders !== headers) {
      responseHeaders = headers;
      return { responseHeaders };
    }
  };
  return (evt) => {
    const type = evt.type;
    if (type === 'loadend') clearRequest(req);
    if (!req.cb) return;
    if (!contentType) {
      contentType = xhr.getResponseHeader('Content-Type') || 'application/octet-stream';
    }
    if (xhr.response !== response) {
      response = xhr.response;
      try {
        responseText = xhr.responseText;
        if (responseText === response) responseText = ['same'];
      } catch (e) {
        // ignore if responseText is unreachable
      }
      if ((blobbed || chunked) && response) {
        dataSize = response.size;
        numChunks = chunked && Math.ceil(dataSize / CHUNK_SIZE) || 1;
      }
    }
    const shouldNotify = req.eventsToNotify.includes(type);
    // only send response when XHR is complete
    const shouldSendResponse = xhr.readyState === 4 && shouldNotify && !sent;
    lastPromise = lastPromise
    .then(() => shouldSendResponse && numChunks && getChunk(response, 0))
    .then(chunk => req.cb({
      blobbed,
      chunked,
      contentType,
      dataSize,
      id,
      numChunks,
      type,
      data: shouldNotify && {
        finalUrl: xhr.responseURL,
        ...getResponseHeaders(),
        ...objectPick(xhr, ['readyState', 'status', 'statusText']),
        ...shouldSendResponse && {
          response: chunk || response,
          responseText,
        },
        ...('loaded' in evt) && objectPick(evt, ['lengthComputable', 'loaded', 'total']),
      },
    }));
    if (shouldSendResponse) {
      sent = true;
      for (let i = 1; i < numChunks; i += 1) {
        const last = i === numChunks - 1;
        lastPromise = lastPromise
        .then(() => getChunk(response, i)) // eslint-disable-line no-loop-func
        .then(data => req.cb({ id, chunk: { data, i, last } }));
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
 * @param {Object} opts
 * @param {chrome.runtime.MessageSender | browser.runtime.MessageSender} src
 * @param {function} cb
 */
async function httpRequest(opts, src, cb) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, id, overrideMimeType, responseType, url } = opts;
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req.anonymous = anonymous;
  const { xhr } = req;
  const vmHeaders = [];
  const FF = ua.isFirefox;
  // Firefox can send Blob/ArrayBuffer directly
  const chunked = !FF && incognito;
  const [body, contentType] = decodeBody(opts.data);
  // Chrome can't fetch Blob URL in incognito so we use chunks
  req.blobbed = responseType && !FF && !incognito;
  req.chunked = chunked;
  // Firefox doesn't send cookies, https://github.com/violentmonkey/violentmonkey/issues/606
  // Both Chrome & FF need explicit routing of cookies in containers or incognito
  let shouldSendCookies = !anonymous && (incognito || FF);
  xhr.open(opts.method || 'GET', url, true, opts.user || '', opts.password || '');
  xhr.setRequestHeader(VM_VERIFY, id);
  if (contentType) xhr.setRequestHeader('Content-Type', contentType);
  opts.headers::forEachEntry(([name, value]) => {
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
  xhr.responseType = chunked && 'blob' || responseType || 'text';
  xhr.timeout = Math.max(0, Math.min(0x7FFF_FFFF, opts.timeout)) || 0;
  if (overrideMimeType) xhr.overrideMimeType(overrideMimeType);
  if (shouldSendCookies) {
    req.noNativeCookie = true;
    for (const store of await browser.cookies.getAllCookieStores()) {
      if (store.tabIds.includes(tab.id)) {
        if (FF ? store.id !== 'firefox-default' : store.id !== '0') {
          /* Cookie routing. For the main store we rely on the browser.
           * The ids are hard-coded as `stores` may omit the main store if no such tabs are open. */
          req.storeId = store.id;
        }
        break;
      }
    }
    const now = Date.now() / 1000;
    const cookies = (await browser.cookies.getAll({
      url,
      storeId: req.storeId,
      ...FF >= 59 && { firstPartyDomain: null },
    })).filter(c => c.session || c.expirationDate > now); // FF reports expired cookies!
    if (cookies.length) {
      vmHeaders.push({
        name: 'cookie',
        value: cookies.map(c => `${c.name}=${c.value};`).join(' '),
      });
    }
  }
  HeaderInjector.add(id, vmHeaders);
  const callback = xhrCallbackWrapper(req);
  req.eventsToNotify.forEach(evt => { xhr[`on${evt}`] = callback; });
  xhr.onloadend = callback; // always send it for the internal cleanup
  xhr.send(body);
}

/** @param {VMHttpRequest} req */
function clearRequest(req) {
  if (req.coreId) delete verify[req.coreId];
  delete requests[req.id];
  HeaderInjector.del(req.id);
  tabRequests[req.tabId]?.delete(req.id);
}

/** Polyfill for Chrome's inability to send complex types over extension messaging */
function decodeBody([body, type, wasBlob]) {
  if (type === 'query') {
    type = 'application/x-www-form-urlencoded';
  } else if (type) {
    // 5x times faster than fetch() which wastes time on inter-process communication
    const res = string2uint8array(atob(body.slice(body.indexOf(',') + 1)));
    if (!wasBlob) {
      type = body.match(/^data:(.+?);base64/)[1].replace(/(boundary=)[^;]+/,
        // using a function so it runs only if "boundary" was found
        (_, p1) => p1 + String.fromCharCode(...res.slice(2, res.indexOf(13))));
    }
    body = res;
  }
  return [body, type];
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
  const { active, id: tabId, incognito } = tab;
  // Not testing tab.pendingUrl because it will be always equal to `url`
  const canReplaceCurTab = (!incognito || ua.isFirefox) && (
    url === from
    || cache.has(`autoclose:${tabId}`)
    || /^(chrome:\/\/(newtab|startpage)\/|about:(home|newtab))$/.test(from));
  cache.put(`confirm-${confirmKey}`, { incognito, url, from, tabId });
  const confirmUrl = `/confirm/index.html#${confirmKey}`;
  const { windowId } = canReplaceCurTab
    ? await browser.tabs.update(tabId, { url: confirmUrl })
    : await commands.TabOpen({ url: confirmUrl, active: !!active }, { tab });
  if (active && windowId !== tab.windowId) {
    await browser.windows.update(windowId, { focused: true });
  }
}

const whitelistRe = new RegExp(`^https://(${
  [
    'greasyfork\\.org/scripts/%/code/',
    'openuserjs\\.org/install/%/',
    'github\\.com/%/%/raw/%/',
    'github\\.com/%/%/releases/%/download/',
    'raw\\.githubusercontent\\.com(/%){3}/',
    'gist\\.github\\.com/.*?/',
  ].join('|')
})%?\\.user\\.js([?#]|$)`.replace(/%/g, '[^/]*'));

const blacklistRe = new RegExp(`^https://(${
  [
    '(gist\\.)?github\\.com',
    'greasyfork\\.org',
    'openuserjs\\.org',
  ].join('|')
})/`);

const resolveVirtualUrl = url => (
  `${extensionRoot}options/index.html#scripts/${+url.split('#')[1]}`
);
// FF can't intercept virtual .user.js URL via webRequest, so we redirect it explicitly
const virtualUrlRe = ua.isFirefox && new RegExp((
  `^(view-source:)?(${extensionRoot.replace('://', '$&)?')}[^/]*\\.user\\.js#\\d+`
));
const maybeRedirectVirtualUrlFF = virtualUrlRe && ((tabId, src) => {
  if (virtualUrlRe.test(src)) {
    browser.tabs.update(tabId, { url: resolveVirtualUrl(src) });
  }
});
if (virtualUrlRe) {
  const listener = (tabId, { url }) => url && maybeRedirectVirtualUrlFF(tabId, url);
  const apiEvent = browser.tabs.onUpdated;
  const addListener = apiEvent.addListener.bind(apiEvent, listener);
  try { addListener({ properties: ['url'] }); } catch (e) { addListener(); }
}

browser.tabs.onCreated.addListener((tab) => {
  const { id, title, url } = tab;
  /* Determining if this tab can be auto-closed (replaced, actually).
     FF>=68 allows reading file: URL only in the tab's content script so the tab must stay open. */
  if ((!url.startsWith('file:') || ua.isFirefox < 68)
      && /\.user\.js([?#]|$)/.test(tab.pendingUrl || url)) {
    cache.put(`autoclose:${id}`, true, 10e3);
  }
  if (virtualUrlRe && url === 'about:blank') {
    maybeRedirectVirtualUrlFF(id, title);
  }
});

browser.webRequest.onBeforeRequest.addListener((req) => {
  const { method, tabId, url } = req;
  if (method !== 'GET') {
    return;
  }
  // open a real URL for simplified userscript URL listed in devtools of the web page
  if (url.startsWith(extensionRoot)) {
    return { redirectUrl: resolveVirtualUrl(url) };
  }
  if (!cache.has(`bypass:${url}`)
  && (!blacklistRe.test(url) || whitelistRe.test(url))) {
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
  if (code && parseMeta(code).name) {
    const tab = tabId >= 0 && await browser.tabs.get(tabId) || {};
    confirmInstall({ code, url, from: tab.url }, { tab });
  } else {
    cache.put(`bypass:${url}`, true, 10e3);
    if (tabId >= 0) browser.tabs.update(tabId, { url });
  }
}

// In Firefox with production code of Violentmonkey, scripts can be injected before `tabs.onUpdated` is fired.
// Ref: https://github.com/violentmonkey/violentmonkey/issues/1255

browser.tabs.onRemoved.addListener((tabId) => {
  clearRequestsByTabId(tabId);
});

export function clearRequestsByTabId(tabId) {
  const set = tabRequests[tabId];
  if (set) {
    delete tabRequests[tabId];
    for (const id of set) {
      commands.AbortRequest(id);
    }
  }
}

/**
 * Imitating https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/getAllResponseHeaders
 * Per the specification https://tools.ietf.org/html/rfc7230 the header name is within ASCII,
 * but we'll try encoding it, if necessary, to handle invalid server responses.
 */
function encodeWebRequestHeader({ name, value, binaryValue }) {
  return `${string2byteString(name)}: ${
    binaryValue
      ? buffer2string(binaryValue)
      : string2byteString(value)
  }\r\n`;
}

/**
 * Returns a UTF8-encoded binary string i.e. one byte per character.
 * Returns the original string in case it was already within ASCII.
 */
function string2byteString(str) {
  if (!/[\u0080-\uFFFF]/.test(str)) return str;
  if (!encoder) encoder = new TextEncoder();
  return buffer2string(encoder.encode(str));
}

/** @typedef {{
  anonymous: boolean
  blobbed: boolean
  cb: function(Object)
  chunked: boolean
  coreId: number
  eventsToNotify: string[]
  id: number
  noNativeCookie: boolean
  responseHeaders: string
  storeId: string
  tabId: number
  xhr: XMLHttpRequest
}} VMHttpRequest */
