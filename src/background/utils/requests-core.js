import { buffer2string, getUniqId, isEmpty, noop } from '@/common';
import { forEachEntry } from '@/common/object';
import ua from '@/common/ua';

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
  user-agent|
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
export const isCookie = header => /^cookie2?$/i.test(header.name);
const isSendable = header => !isVmVerify(header)
  && !(/^origin$/i.test(header.name) && header.value === extensionOrigin);
const isSendableAnon = header => isSendable(header) && !isCookie(header);
const SET_COOKIE_RE = /^set-cookie2?$/i;
const SET_COOKIE_VALUE_RE = re`
  /^\s*  (?:__(Secure|Host)-)?  ([^=\s]+)  \s*=\s*  (")?  ([!#-+\--:<-[\]-~]*)  \3(.*)  /x`;
const SET_COOKIE_ATTR_RE = re`
  /\s*  ;?\s*  (\w+)  (?:= (")?  ([!#-+\--:<-[\]-~]*)  \2)?  /xy`;
const SAME_SITE_MAP = {
  strict: 'strict',
  lax: 'lax',
  none: 'no_restriction',
};
const API_EVENTS = {
  onBeforeSendHeaders: [
    onBeforeSendHeaders, 'requestHeaders', 'blocking', ...EXTRA_HEADERS,
  ],
  onHeadersReceived: [
    onHeadersReceived, kResponseHeaders, 'blocking', ...EXTRA_HEADERS,
  ],
};

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onHeadersReceived({ [kResponseHeaders]: headers, requestId, url }) {
  const req = requests[verify[requestId]];
  if (req) {
    // Hide Set-Cookie headers from the browser, and optionally set them in req.storeId
    const { storeId } = req;
    if (req.anonymous || storeId) {
      headers = headers.filter(h => !SET_COOKIE_RE.test(h.name) || storeId && (
        setCookieInStore(h.value, storeId, url),
        false // overriding to allow declaring the function as `async`
      ));
    }
    // Populate responseHeaders for GM_xhr's `response`
    req[kResponseHeaders] = headers.map(encodeWebRequestHeader).join('');
    return { [kResponseHeaders]: headers };
  }
}

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onBeforeSendHeaders({ requestHeaders: headers, requestId, url }) {
  // only the first call during a redirect/auth chain will have VM-Verify header
  const reqId = verify[requestId] || headers.find(isVmVerify)?.value;
  const req = requests[reqId];
  if (req) {
    verify[requestId] = reqId;
    req.coreId = requestId;
    req.url = url; // remember redirected URL with #hash as it's stripped in XHR.responseURL
    const headers2 = headersToInject[reqId] || [];
    const i = headers.findIndex(isCookie);
    const j = headers2.findIndex(isCookie);
    if (i >= 0) {
      if (req.noNativeCookie) {
        headers.splice(i, 1);
      } else if (j >= 0) {
        headers[i].value += '; ' + headers2.splice(j, 1)[0].value;
      }
    }
    headers = headers.concat(headers2)
    .filter(req.anonymous ? isSendableAnon : isSendable);
  }
  return { requestHeaders: headers };
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

export function toggleHeaderInjector(reqId, headers) {
  if (headers) {
    // Adding even if empty so that the toggle-off `if` runs just once even when called many times
    headersToInject[reqId] = headers;
    // Listening even if `headers` is empty to get the request's id
    API_EVENTS::forEachEntry(([name, [listener, ...options]]) => {
      browser.webRequest[name].addListener(listener, API_FILTER, options);
    });
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
if (ua.chrome >= 74 && ua.chrome <= 91) {
  browser.webRequest.onBeforeSendHeaders.addListener(noop, API_FILTER, EXTRA_HEADERS);
}
