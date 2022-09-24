import { blob2base64, sendTabCmd, string2uint8array } from '@/common';
import { forEachEntry, forEachValue, objectPick } from '@/common/object';
import ua from '@/common/ua';
import cache from './cache';
import { commands } from './message';
import {
  FORBIDDEN_HEADER_RE, VM_VERIFY, requests, toggleHeaderInjector, verify,
} from './requests-core';

Object.assign(commands, {
  /** @return {void} */
  HttpRequest(opts, src) {
    const { tab: { id: tabId }, frameId } = src;
    const { id, eventsToNotify } = opts;
    requests[id] = {
      id,
      tabId,
      eventsToNotify,
      xhr: new XMLHttpRequest(),
    };
    // Returning will show JS exceptions during init phase in the tab console
    return httpRequest(opts, src, res => requests[id] && (
      sendTabCmd(tabId, 'HttpRequested', res, { frameId })
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

/* 1MB takes ~20ms to encode/decode so it doesn't block the process of the extension and web page,
 * which lets us and them be responsive to other events or user input. */
const CHUNK_SIZE = 1e6;

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
    if (!contentType) {
      contentType = xhr.getResponseHeader('Content-Type') || 'application/octet-stream';
    }
    if (xhr.response !== response) {
      response = xhr.response;
      sent = false;
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
    const { type } = evt;
    const shouldNotify = req.eventsToNotify.includes(type);
    // only send response when XHR is complete
    const shouldSendResponse = xhr.readyState === 4 && shouldNotify && !sent;
    if (!shouldNotify && type !== 'loadend') {
      return;
    }
    lastPromise = lastPromise.then(async () => {
      await req.cb({
        blobbed,
        chunked,
        contentType,
        dataSize,
        id,
        numChunks,
        type,
        data: shouldNotify && {
          finalUrl: req.url || xhr.responseURL,
          ...getResponseHeaders(),
          ...objectPick(xhr, ['readyState', 'status', 'statusText']),
          ...('loaded' in evt) && objectPick(evt, ['lengthComputable', 'loaded', 'total']),
          response: shouldSendResponse
            ? numChunks && await getChunk(response, 0) || response
            : null,
          responseText: shouldSendResponse
            ? responseText
            : null,
        },
      });
      if (shouldSendResponse) {
        for (let i = 1; i < numChunks; i += 1) {
          await req.cb({
            id,
            chunk: {
              pos: i * CHUNK_SIZE,
              data: await getChunk(response, i),
              last: i + 1 === numChunks,
            },
          });
        }
      }
      if (type === 'loadend') {
        clearRequest(req);
      }
    });
  };
}

/**
 * @param {Object} opts
 * @param {chrome.runtime.MessageSender | browser.runtime.MessageSender} src
 * @param {function} cb
 */
async function httpRequest(opts, src, cb) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, id, overrideMimeType, xhrType, url } = opts;
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req.anonymous = anonymous;
  const { xhr } = req;
  const vmHeaders = [];
  // Firefox can send Blob/ArrayBuffer directly
  const willStringifyBinaries = xhrType && !IS_FIREFOX;
  const chunked = willStringifyBinaries && incognito;
  const blobbed = willStringifyBinaries && !incognito;
  const [body, contentType] = decodeBody(opts.data);
  // Chrome can't fetch Blob URL in incognito so we use chunks
  req.blobbed = blobbed;
  req.chunked = chunked;
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
      shouldSendCookies = !/^cookie$/i.test(name);
    }
  });
  xhr.responseType = willStringifyBinaries && 'blob' || xhrType || 'text';
  xhr.timeout = Math.max(0, Math.min(0x7FFF_FFFF, opts.timeout)) || 0;
  if (overrideMimeType) xhr.overrideMimeType(overrideMimeType);
  if (shouldSendCookies) {
    req.noNativeCookie = true;
    for (const store of await browser.cookies.getAllCookieStores()) {
      if (store.tabIds.includes(tab.id)) {
        if (IS_FIREFOX ? store.id !== 'firefox-default' : store.id !== '0') {
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
  const callback = xhrCallbackWrapper(req);
  req.eventsToNotify.forEach(evt => { xhr[`on${evt}`] = callback; });
  xhr.onloadend = callback; // always send it for the internal cleanup
  xhr.send(body);
}

/** @param {VMHttpRequest} req */
function clearRequest({ id, coreId }) {
  delete verify[coreId];
  delete requests[id];
  toggleHeaderInjector(id, false);
}

export function clearRequestsByTabId(tabId) {
  requests::forEachValue(req => {
    if (req.tabId === tabId) {
      commands.AbortRequest(req.id);
    }
  });
}

/** Polyfill for Chrome's inability to send complex types over extension messaging */
function decodeBody([body, type, wasBlob]) {
  if (type === 'query') {
    type = 'application/x-www-form-urlencoded';
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

// In Firefox with production code of Violentmonkey, scripts can be injected before `tabs.onUpdated` is fired.
// Ref: https://github.com/violentmonkey/violentmonkey/issues/1255
browser.tabs.onRemoved.addListener(clearRequestsByTabId);
