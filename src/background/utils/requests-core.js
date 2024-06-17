import { buffer2string, getUniqId, isEmpty, noop } from '@/common';
import { forEachEntry } from '@/common/object';
import { CHROME } from './ua';

let encoder;

export const VM_VERIFY = getUniqId('VM-Verify');
/** @type {Object<string,GMReq.BG>} */
export const requests = { __proto__: null };
export const verify = { __proto__: null };
export const FORBIDDEN_HEADER_RE = re`/
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
)$/ix`;
/** @type {chrome.webRequest.RequestFilter} */
const API_FILTER = {
  urls: ['<all_urls>'],
  types: ['xmlhttprequest'],
};
const EXTRA_HEADERS = [
  browser.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS,
].filter(Boolean);
const headersToInject = {};
/** @param {chrome.webRequest.HttpHeader} header */
const isVmVerify = header => header.name === VM_VERIFY;
export const kCookie = 'cookie';
export const kSetCookie = 'set-cookie';
const SET_COOKIE_VALUE_RE = re`
  /^\s*  (?:__(Secure|Host)-)?  ([^=\s]+)  \s*=\s*  (")?  ([!#-+\--:<-[\]-~]*)  \3(.*)  /x`;
const SET_COOKIE_ATTR_RE = re`
  /\s*  ;?\s*  (\w+)  (?:= (")?  ([!#-+\--:<-[\]-~]*)  \2)?  /xy`;
const SAME_SITE_MAP = {
  strict: 'strict',
  lax: 'lax',
  none: 'no_restriction',
};
const kRequestHeaders = 'requestHeaders';
const API_EVENTS = {
  onBeforeSendHeaders: [
    onBeforeSendHeaders, kRequestHeaders, 'blocking', ...EXTRA_HEADERS,
  ],
  onHeadersReceived: [
    onHeadersReceived, kResponseHeaders, 'blocking', ...EXTRA_HEADERS,
  ],
};

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onHeadersReceived({ [kResponseHeaders]: headers, requestId, url }) {
  const req = requests[verify[requestId]];
  if (req) {
    // Populate responseHeaders for GM_xhr's `response`
    req[kResponseHeaders] = headers.map(encodeWebRequestHeader).join('');
    const { storeId } = req;
    // Drop Set-Cookie headers if anonymous or using a custom storeId
    if (!req[kSetCookie] || storeId) {
      headers = headers.filter(h => {
        if (h.name.toLowerCase() !== kSetCookie) return true;
        if (storeId) setCookieInStore(h.value, storeId, url);
      });
      return { [kResponseHeaders]: headers };
    }
  }
}

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onBeforeSendHeaders({ [kRequestHeaders]: headers, requestId, url }) {
  // only the first call during a redirect/auth chain will have VM-Verify header
  const reqId = verify[requestId] || headers.find(isVmVerify)?.value;
  const req = requests[reqId];
  if (req) {
    verify[requestId] = reqId;
    req.coreId = requestId;
    req.url = url; // remember redirected URL with #hash as it's stripped in XHR.responseURL
    const headersMap = {};
    const headers2 = headersToInject[reqId];
    const combinedHeaders = headers2 && {};
    let name;
    let h2 = !headers2;
    for (const h of headers) {
      if ((name = h.name) === VM_VERIFY
      || (name = name.toLowerCase()) === 'origin' && h.value === extensionOrigin
      || name === kCookie && !req[kCookie]) {
        continue;
      }
      if (!h2 && name === kCookie && (h2 = headers2[name])) {
        combinedHeaders[name] = { name, value: h.value + '; ' + h2.value };
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
    /* Listening even if `headers` array is empty to get the request's id.
     * Registering just once to avoid a bug in Chrome:
     * it adds a new internal registration even if the function reference is the same */
    if (isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener, ...options]]) => {
        browser.webRequest[name].addListener(listener, API_FILTER, options);
      });
    }
    // Adding even if empty so that the toggle-off `if` runs just once even when called many times
    headersToInject[reqId] = headers;
  } else if (reqId in headersToInject) {
    delete headersToInject[reqId];
    if (isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener]]) => {
        browser.webRequest[name].removeListener(listener);
      });
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
 * @param {string} headerValue
 * @param {string} storeId
 * @param {string} url
 */
function setCookieInStore(headerValue, storeId, url) {
  let m = SET_COOKIE_VALUE_RE.exec(headerValue);
  if (m) {
    const [, prefix, name, , value, optStr] = m;
    const opt = {};
    const isHost = prefix === 'Host';
    SET_COOKIE_ATTR_RE.lastIndex = 0;
    while ((m = SET_COOKIE_ATTR_RE.exec(optStr))) {
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
      storeId,
    });
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
if (CHROME >= 74 && CHROME <= 91) {
  browser.webRequest.onBeforeSendHeaders.addListener(noop, API_FILTER, EXTRA_HEADERS);
}
