import { buffer2string, isEmpty, noop } from '@/common';
import { forEachEntry } from '@/common/object';
import { CHROME } from './ua';
import { mergeCookieHeaders } from './requests-cookies';

let encoder;

/** @type {Object<string,GMReq.BG>} */
export const requests = { __proto__: null };
export const verify = { __proto__: null };
export const FORBIDDEN_HEADER_RE = regex('i')`
^(
  # prefix matches
  proxy-|
  sec-
)|^(
  # whole name matches
  # https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
  # https://cs.chromium.org/?q=file:cc+symbol:IsForbiddenHeader%5Cb
  accept-(charset|encoding)|
  access-control-request-(headers|method)|
  connection|
  content-length|
  cookie2?|
  date|
  dnt|
  expect|
  host|
  keep-alive|
  origin|
  referer|
  te|
  trailer|
  transfer-encoding|
  upgrade|
  via
)$`;
/** @type {chrome.webRequest.RequestFilter} */
const API_FILTER = {
  urls: ['<all_urls>'],
  types: ['xmlhttprequest'],
};
const EXTRA_HEADERS = [
  !__.MV3 && 'blocking',
  browser.webRequest?.OnBeforeSendHeadersOptions?.EXTRA_HEADERS,
].filter(Boolean);
const headersToInject = {};
const attachedEvents = {};
export const kCookie = 'cookie';
export const kSetCookie = 'set-cookie';
const SET_COOKIE_VALUE_RE = regex({ disable: { n: true } })`
  ^\s*  (?:__(Secure|Host)-)?  ([^=\s]+)  \s*=\s*  (")?  ([!#-+\--:\<-\[\]-~]*)  \3(.*)`;
const SAME_SITE_MAP = {
  strict: 'strict',
  lax: 'lax',
  none: 'no_restriction',
};
export const kRequestHeaders = 'requestHeaders';
const API_EVENTS = {
  onBeforeSendHeaders: [onBeforeSendHeaders, kRequestHeaders, ...EXTRA_HEADERS],
  onHeadersReceived: [onHeadersReceived, kResponseHeaders, ...EXTRA_HEADERS],
};
/** Chrome leaks empty dynamic registrations, https://crbug.com/526929792 */
const CHROME_REG_LEAK_BUG = __.MV3 && CHROME >= 146;

/** @param {chrome.webRequest.WebRequestDetails} details */
function onHeadersReceived({ [kResponseHeaders]: headers, requestId, tabId, url }) {
  if (CHROME_REG_LEAK_BUG && tabId !== -1) return;
  const req = requests[verify[requestId]];
  if (req) {
    // Populate responseHeaders for GM_xhr's `response`
    req[kResponseHeaders] = headers.map(encodeWebRequestHeader).join('');
    const { storeId, cookiePartition } = req;
    // Drop Set-Cookie headers if anonymous or using a custom storeId
    if (!req[kSetCookie] || storeId || cookiePartition) {
      headers = headers.filter(h => {
        if (h.name.toLowerCase() !== kSetCookie) return true;
        if (req[kSetCookie] && (storeId || cookiePartition)) {
          setCookieInStore(h.value, storeId, url, cookiePartition);
        }
      });
      if (!__.MV3) return { [kResponseHeaders]: headers };
    }
  }
}

/** @param {chrome.webRequest.WebRequestDetails} details */
function onBeforeSendHeaders({ [kRequestHeaders]: headers, requestId, tabId, url }) {
  if (CHROME_REG_LEAK_BUG && tabId !== -1) return;
  let req;
  let reqId = verify[requestId];
  if (reqId) {
    req = requests[reqId];
  } else {
    reqId = url.split('#')[1];
    req = requests[reqId];
    if (req) {
      verify[requestId] = reqId;
      req.coreId = requestId;
    }
  }
  if (req) {
    // remember redirected URL with #hash as it's stripped in XHR.responseURL
    // browsers re-append our #reqId to redirected URL if the server didn't redirect to a new #hash
    if (url !== req.xhrUrl) req.url = url.replace('#' + reqId, '');
    if (__.MV3) return;
    const headersMap = {};
    const headers2 = headersToInject[reqId];
    const combinedHeaders = headers2 && {};
    let h2 = !headers2;
    for (const h of headers) {
      let name = h.name.toLowerCase();
      if (name === 'origin' && h.value === extensionOrigin
      || name === kCookie && !req[kCookie]) {
        continue;
      }
      if (!h2 && name === kCookie && (h2 = headers2[name])) {
        combinedHeaders[name] = { name, value: mergeCookieHeaders(h.value, h2.value) };
      } else {
        headersMap[name] = h;
      }
    }
    return {
      [kRequestHeaders]: Object.values(Object.assign(headersMap, headers2, combinedHeaders))
    };
  }
}

export function toggleHeaderInjector(reqId, headers) {
  if (headers) {
    if (isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener, ...options]]) => {
        const event = browser.webRequest?.[name];
        if (event?.addListener) {
          try {
            event.addListener(listener, API_FILTER, options);
            attachedEvents[name] = true;
          } catch {
            try {
              event.addListener(listener, API_FILTER, options.filter(opt => opt !== 'extraHeaders'));
              attachedEvents[name] = true;
            } catch {/**/}
          }
        }
      });
    }
    // Adding even if empty so that the toggle-off `if` runs just once even when called many times
    headersToInject[reqId] = headers;
  } else if (reqId in headersToInject) {
    delete headersToInject[reqId];
    if (!CHROME_REG_LEAK_BUG && isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener]]) => {
        if (attachedEvents[name]) {
          try { browser.webRequest?.[name]?.removeListener(listener); } catch {/**/}
          delete attachedEvents[name];
        }
      });
    }
  }
  return !!attachedEvents.onBeforeSendHeaders && !!attachedEvents.onHeadersReceived;
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
 * @param {string} headerValue
 * @param {string} storeId
 * @param {string} url
 */
function setCookieInStore(headerValue, storeId, url, cookiePartition) {
  let m = SET_COOKIE_VALUE_RE.exec(headerValue);
  if (m) {
    const [, prefix, name, , value, optStr] = m;
    const opt = {};
    const isHost = prefix === 'Host';
    for (const part of optStr.split(';')) {
      const pos = part.indexOf('=');
      const key = (pos < 0 ? part : part.slice(0, pos)).trim().toLowerCase();
      if (key) {
        let val = pos < 0 ? '' : part.slice(pos + 1).trim();
        if (val[0] === '"' && val.endsWith('"')) val = val.slice(1, -1);
        opt[key] = val;
      }
    }
    const sameSite = opt.samesite?.toLowerCase();
    const expiration = /^-?\d+$/.test(opt['max-age'])
      ? Date.now() / 1000 + +opt['max-age']
      : Date.parse(opt.expires) / 1000;
    browser.cookies.set({
      url,
      name: prefix ? `__${prefix}-${name}` : name,
      value,
      domain: isHost ? undefined : opt.domain,
      expirationDate: Number.isFinite(expiration) ? Math.max(0, expiration) : undefined,
      httpOnly: 'httponly' in opt,
      path: isHost ? '/' : opt.path,
      sameSite: SAME_SITE_MAP[sameSite],
      secure: url.startsWith('https:') && (!!prefix || sameSite === 'none' || 'secure' in opt),
      storeId,
      ...cookiePartition && 'partitioned' in opt && { partitionKey: cookiePartition },
    }).catch(noop);
  }
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

// Chrome 74-91 needs an extraHeaders listener at tab load start, https://crbug.com/1074282
// We're attaching a no-op in non-blocking mode so it's very lightweight and fast.
if (!__.MV3 && CHROME >= 74 && CHROME <= 91) {
  try {
    browser.webRequest?.onBeforeSendHeaders?.addListener(noop, API_FILTER, EXTRA_HEADERS);
  } catch {/**/}
}
// Attaching globally will see all XHRs in all tabs because tabId:-1 in addListener is ignored
if (CHROME_REG_LEAK_BUG) toggleHeaderInjector('', []);
