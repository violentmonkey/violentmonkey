import { blob2base64, getFullUrl, sendTabCmd, string2uint8array } from '@/common';
import { CHARSET_UTF8, FORM_URLENCODED } from '@/common/consts';
import { forEachEntry, forEachValue, objectPick } from '@/common/object';
import ua from '@/common/ua';
import cache from './cache';
import { addPublicCommands, commands } from './message';
import {
  FORBIDDEN_HEADER_RE, VM_VERIFY, isCookie, requests, toggleHeaderInjector, verify,
} from './requests-core';

addPublicCommands({
  /**
   * @param {GMReq.Message.Web} opts
   * @param {MessageSender} src
   * @return {Promise<void>}
   */
  HttpRequest(opts, src) {
    const { tab: { id: tabId }, frameId } = src;
    const { id, events } = opts;
    const cb = res => requests[id] && (
      sendTabCmd(tabId, 'HttpRequested', res, { frameId })
    );
    /** @type {GMReq.BG} */
    requests[id] = {
      id,
      tabId,
      frameId,
      xhr: new XMLHttpRequest(),
    };
    return httpRequest(opts, events, src, cb)
    .catch(events.includes('error') && (err => cb({
      id,
      error: err.message,
      data: null,
      type: 'error',
    })));
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

/* 1MB takes ~20ms to encode/decode so it doesn't block the process of the extension and web page,
 * which lets us and them be responsive to other events or user input. */
const CHUNK_SIZE = 1e6;
const BLOB_LIFE = 60e3;
const SEND_XHR_PROPS = ['readyState', 'status', 'statusText'];
const SEND_PROGRESS_PROPS = ['lengthComputable', 'loaded', 'total'];

function blob2chunk(response, index) {
  return blob2base64(response, index * CHUNK_SIZE, CHUNK_SIZE);
}

function blob2objectUrl(response) {
  const url = URL.createObjectURL(response);
  cache.put(`xhrBlob:${url}`, setTimeout(URL.revokeObjectURL, BLOB_LIFE, url), BLOB_LIFE);
  return url;
}

/**
 * @param {GMReq.BG} req
 * @param {GMReq.EventType[]} events
 * @param {boolean} blobbed
 * @param {boolean} chunked
 * @param {boolean} isJson
 */
function xhrCallbackWrapper(req, events, blobbed, chunked, isJson) {
  let lastPromise = Promise.resolve();
  let contentType;
  let dataSize;
  let numChunks = 0;
  let response = null;
  let responseText;
  let responseHeaders;
  let sent = true;
  let tmp;
  const { id, xhr } = req;
  const getChunk = blobbed && blob2objectUrl || chunked && blob2chunk;
  const getResponseHeaders = () => req[kResponseHeaders] || xhr.getAllResponseHeaders();
  const eventQueue = [];
  const sequentialize = async () => {
    if (!contentType) {
      contentType = xhr.getResponseHeader('Content-Type') || '';
    }
    if (xhr[kResponse] !== response) {
      response = xhr[kResponse];
      sent = false;
      try {
        responseText = xhr[kResponseText];
        if (responseText === response) responseText = ['same'];
      } catch (e) {
        // ignore if responseText is unreachable
      }
      if ((blobbed || chunked) && response) {
        dataSize = response.size;
        numChunks = chunked && Math.ceil(dataSize / CHUNK_SIZE) || 1;
      }
    }
    const evt = eventQueue.shift();
    const { type } = evt;
    const shouldNotify = events.includes(type);
    // TODO: send partial delta since last time in onprogress?
    const shouldSendResponse = shouldNotify && (!isJson || xhr.readyState === 4) && !sent;
    if (!shouldNotify && type !== 'loadend') {
      return;
    }
    if (shouldSendResponse) {
      sent = true;
      for (let i = 1; i < numChunks; i += 1) {
        await req.cb({
          id,
          chunk: i * CHUNK_SIZE,
          data: await getChunk(response, i),
          size: dataSize,
        });
      }
    }
    /* WARNING! We send `null` in the mandatory props because Chrome can't send `undefined`,
     * and for simple destructuring and `prop?.foo` in the receiver without getOwnProp checks. */
    await req.cb({
      blobbed,
      chunked,
      contentType,
      id,
      type,
      /** @type {VMScriptResponseObject} */
      data: shouldNotify ? {
        finalUrl: req.url || xhr.responseURL,
        ...objectPick(xhr, SEND_XHR_PROPS),
        ...objectPick(evt, SEND_PROGRESS_PROPS),
        [kResponse]: shouldSendResponse
          ? numChunks && await getChunk(response, 0) || response
          : null,
        [kResponseHeaders]: responseHeaders !== (tmp = getResponseHeaders())
          ? (responseHeaders = tmp)
          : null,
        [kResponseText]: shouldSendResponse
          ? responseText
          : null,
      } : null,
    });
    if (type === 'loadend') {
      clearRequest(req);
    }
  };
  return (evt) => {
    eventQueue.push(evt);
    lastPromise = lastPromise.then(sequentialize);
  };
}

/**
 * @param {GMReq.Message.Web} opts
 * @param {GMReq.EventType[]} events
 * @param {MessageSender} src
 * @param {function} cb
 * @returns {Promise<void>}
 */
async function httpRequest(opts, events, src, cb) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, id, overrideMimeType, xhrType } = opts;
  const url = getFullUrl(opts.url, src.url);
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req.anonymous = anonymous;
  const { xhr } = req;
  const vmHeaders = [];
  // Firefox can send Blob/ArrayBuffer directly
  const willStringifyBinaries = xhrType && !IS_FIREFOX;
  // Chrome can't fetch Blob URL in incognito so we use chunks
  const chunked = willStringifyBinaries && incognito;
  const blobbed = willStringifyBinaries && !incognito;
  const [body, contentType] = decodeBody(opts.data);
  // Firefox doesn't send cookies, https://github.com/violentmonkey/violentmonkey/issues/606
  // Both Chrome & FF need explicit routing of cookies in containers or incognito
  let shouldSendCookies = !anonymous && (incognito || IS_FIREFOX);
  xhr.open(opts.method || 'GET', url, true, opts.user || '', opts.password || '');
  xhr.setRequestHeader(VM_VERIFY, id);
  if (contentType) xhr.setRequestHeader('Content-Type', contentType);
  opts.headers::forEachEntry(([name, value]) => {
    if (FORBIDDEN_HEADER_RE.test(name)) {
      vmHeaders.push({ name, value });
    } else {
      xhr.setRequestHeader(name, value);
    }
    if (shouldSendCookies) {
      shouldSendCookies = !isCookie({ name });
    }
  });
  xhr[kResponseType] = willStringifyBinaries && 'blob' || xhrType || 'text';
  xhr.timeout = Math.max(0, Math.min(0x7FFF_FFFF, opts.timeout)) || 0;
  if (overrideMimeType) xhr.overrideMimeType(overrideMimeType);
  if (shouldSendCookies) {
    req.noNativeCookie = true;
    for (const store of await browser.cookies.getAllCookieStores()) {
      if (store.tabIds.includes(tab.id)) {
        if (IS_FIREFOX ? !store.id.endsWith('-default') : store.id !== '0') {
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
      ...ua.firefox >= 59 && { firstPartyDomain: null },
    })).filter(c => c.session || c.expirationDate > now); // FF reports expired cookies!
    if (cookies.length) {
      vmHeaders.push({
        name: 'cookie',
        value: cookies.map(c => `${c.name}=${c.value};`).join(' '),
      });
    }
  }
  toggleHeaderInjector(id, vmHeaders);
  // Sending as params to avoid storing one-time init data in `requests`
  const callback = xhrCallbackWrapper(req, events, blobbed, chunked, opts[kResponseType] === 'json');
  events.forEach(evt => { xhr[`on${evt}`] = callback; });
  xhr.onloadend = callback; // always send it for the internal cleanup
  xhr.send(body);
}

/** @param {GMReq.BG} req */
function clearRequest({ id, coreId }) {
  delete verify[coreId];
  delete requests[id];
  toggleHeaderInjector(id, false);
}

export function clearRequestsByTabId(tabId, frameId) {
  requests::forEachValue(req => {
    if ((tabId == null || req.tabId === tabId)
    && (!frameId || req.frameId === frameId)) {
      commands.AbortRequest(req.id);
    }
  });
}

/** Polyfill for browser's inability to send complex types over extension messaging */
function decodeBody([body, type, wasBlob]) {
  if (type === 'fd') {
    // FF supports FormData over messaging
    // Chrome doesn't - we use this code only with an empty FormData just to create the object
    const res = new FormData();
    body.forEach(entry => res.set(...entry));
    body = res;
    type = '';
  } else if (type === 'usp') {
    type = FORM_URLENCODED + ';' + CHARSET_UTF8;
  } else if (type != null) {
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
