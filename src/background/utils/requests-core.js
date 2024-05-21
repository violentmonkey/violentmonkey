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
const isntSetCookie = header => !/^set-cookie2?$/i.test(header.name);
export const kCookie = 'cookie';
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
function onHeadersReceived({ [kResponseHeaders]: headers, requestId }) {
  const req = requests[verify[requestId]];
  if (req) {
    // Populate responseHeaders for GM_xhr's `response`
    req[kResponseHeaders] = headers.map(encodeWebRequestHeader).join('');
    return { [kResponseHeaders]: headers.filter(isntSetCookie) };
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
    let name;
    let h2 = !headers2;
    for (const h of headers) {
      if ((name = h.name) === VM_VERIFY
      || (name = name.toLowerCase()) === 'origin' && h.value === extensionOrigin
      || name === kCookie && req.noNativeCookie) {
        continue;
      }
      if (!h2 && name === kCookie && (h2 = headers2[name])) {
        // combining with the original value of the custom header
        h2.value = h.value + '; ' + (req[name] || (req[name] = h2.value));
      } else {
        headersMap[name] = h;
      }
    }
    return {
      [kRequestHeaders]: Object.values(Object.assign(headersMap, headers2))
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
