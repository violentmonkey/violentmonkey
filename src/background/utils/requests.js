import { keepAlive, sendTabCmd, string2uint8array } from '@/common';
import { CHARSET_UTF8, FORM_URLENCODED, UA_PROPS, UPLOAD } from '@/common/consts';
import { downloadBlob } from '@/common/download';
import { deepEqual, forEachEntry, forEachValue } from '@/common/object';
import { initXHR } from '@/offscreen/xhr';
import { addOwnCommands, addPublicCommands, commands } from './init';
import callOffscreen from './offscreen';
import { DNR_ID_XHR, updateSessionRules, xhrRules } from './dnr';
import {
  FORBIDDEN_HEADER_RE, kCookie, kSetCookie, requests, toggleHeaderInjector, verify,
} from './requests-core';
import { getFrameDocIdAsObj, getFrameDocIdFromSrc } from './tabs';
import { navUA, navUAD } from './ua';
import { vetUrl } from './url';

if (__.MV3) addOwnCommands({
  XHRNotify(data) {
    const req = requests[data.id];
    req.cb(data);
    if (data.type === 'loadend' && !data[UPLOAD]) {
      clearRequest(req);
    }
  },
});
else addPublicCommands({
  DownloadBlob(args) {
    downloadBlob(...args);
  },
});

addPublicCommands({
  /**
   * @param {GMReq.Message.Web} opts
   * @param {VMMessageSender} src
   * @return {Promise<void>}
   */
  HttpRequest(opts, src) {
    const tabId = src.tab.id;
    const frameId = getFrameDocIdFromSrc(src);
    const { id, events } = opts;
    const req = requests[id] = {
      id,
      tabId,
      [kFrameId]: frameId,
      frame: getFrameDocIdAsObj(frameId),
    };
    /** @param {GMReq.Message.BGAny} res */
    const cb = res => requests[id] && (
      __.MV3 && req.url && res.data && (res.data.finalUrl = req.url), // from onBeforeSendHeaders
      sendTabCmd(tabId, 'HttpRequested', res, req.frame)
    );
    return httpRequest(opts, events, src, cb)
    .catch(err => cb({
      id,
      [ERROR]: [err.message || `${err}`, err.name],
      data: null,
      type: ERROR,
    }));
  },
  /** @return {void | Promise<void>} */
  AbortRequest: id => requests[id] && (__.MV3
    ? callOffscreen('XHRStop', id)
    : requests[id].xhr.abort()
  ),
  // TODO: check if the content script can revoke it
  RevokeBlob: url => __.MV3
    ? callOffscreen('RevokeBlob', url)
    : URL.revokeObjectURL(url),
});

const quoteHeaderValue = str => `"${str.replace(/[\\"]/g, '\\$&')}"`;
const SEC_CH_UA = 'sec-ch-ua';
const UA_GETTERS = {
  __proto__: null,
  'user-agent': val => val,
  /** @param {NavigatorUABrandVersion[]} brands */
  [SEC_CH_UA]: brands => brands.map(b => `${quoteHeaderValue(b.brand)};v="${b.version}"`).join(', '),
  [SEC_CH_UA + '-mobile']: val => `?${val ? 1 : 0}`,
  [SEC_CH_UA + '-platform']: quoteHeaderValue,
};
const UA_HEADERS = Object.keys(UA_GETTERS);

/**
 * @param {GMReq.Message.Web} opts
 * @param {GMReq.EventTypeMap[]} events
 * @param {VMMessageSender} src
 * @param {function} cb
 * @returns {Promise<void>}
 */
async function httpRequest(opts, events, src, cb) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, id, overrideMimeType, [kXhrType]: xhrType } = opts;
  const url = vetUrl(opts.url, src.url, true);
  const req = requests[id];
  if (!req || req.cb) return;
  req[kFileName] = opts[kFileName];
  const vmHeaders = __.MV3 ? [] : {};
  const xhrHeaders = {};
  const xhrProps = {};
  // Firefox can send Blob/ArrayBuffer directly
  // TODO: add Chrome when "message_serialization" graduates from Canary into Stable
  const willStringifyBinaries = xhrType && !IS_FIREFOX;
  // Chrome can't fetch Blob URL in incognito so we use chunks
  const chunked = willStringifyBinaries && incognito;
  const blobbed = willStringifyBinaries && !incognito;
  const [body, contentType] = decodeBody(opts.data);
  // Firefox doesn't send cookies, https://github.com/violentmonkey/violentmonkey/issues/606
  // Both Chrome & FF need explicit routing of cookies in containers or incognito
  const shouldSendCookies = !anonymous && (incognito || IS_FIREFOX);
  const uaHeaders = [];
  req[kCookie] = !anonymous && !shouldSendCookies;
  req[kSetCookie] = !anonymous;
  if (contentType) xhrHeaders['Content-Type'] = contentType;
  opts.headers::forEachEntry(([name, value]) => {
    const nameLow = name.toLowerCase();
    const i = UA_HEADERS.indexOf(nameLow);
    if (i >= 0 && (uaHeaders[i] = true) || FORBIDDEN_HEADER_RE.test(name)) {
      pushHeader(vmHeaders, name, value, nameLow);
    } else {
      xhrHeaders[name] = value;
    }
  });
  opts.ua.forEach((val, i) => {
    if (!uaHeaders[i] && !deepEqual(val, !i ? navUA : navUAD[UA_PROPS[i]])) {
      const name = UA_HEADERS[i];
      pushHeader(vmHeaders, name, UA_GETTERS[name](val), name);
    }
  });
  xhrProps[kResponseType] = willStringifyBinaries && 'blob' || xhrType || 'text';
  xhrProps.timeout = Math.max(0, Math.min(0x7FFF_FFFF, opts.timeout)) || 0;
  if (shouldSendCookies) {
    for (const store of await browser.cookies.getAllCookieStores()) {
      if (store.tabIds.includes(tab.id)) {
        if (!__.MV3 && IS_FIREFOX ? !store.id.endsWith('-default') : store.id !== '0') {
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
      ...!__.MV3 && IS_FIREFOX && { firstPartyDomain: null },
    })).filter(c => c.session || c.expirationDate > now); // FF reports expired cookies!
    if (cookies.length) {
      pushHeader(vmHeaders, kCookie,
        cookies.map(c => `${c.name}=${c.value};`).join(' '));
    }
  }
  const xhrUrl = req.xhrUrl = url.split('#', 1)[0] + '#' + id;
  const xhrOpts = /** @namespace XHRStartOptions */{
    body,
    events,
    open: [opts.method || 'GET', xhrUrl, true, opts.user || '', opts.password || ''],
    // Sending as params to avoid storing one-time init data in `requests`
    cb: [req, events, blobbed, chunked, opts[kResponseType] === 'json'],
    headers: xhrHeaders,
    mime: overrideMimeType,
    props: xhrProps,
  };
  toggleHeaderInjector(id, vmHeaders, xhrUrl);
  Object.defineProperty(req, 'cb', {value: cb}); // non-enumerable to ensure it's not messaged
  if (__.MV3) {
    if (vmHeaders.length) addDnrHeaders(req, xhrUrl, vmHeaders);
    await callOffscreen('XHRStart', xhrOpts); // send the pure object,
    req.resolve = keepAlive(); // ...then add an unsendable prop (function)
  } else {
    initXHR(xhrOpts);
  }
}

function addDnrHeaders(req, xhrUrl, vmHeaders) {
  let ruleId = DNR_ID_XHR; while (xhrRules[++ruleId]) {/**/}
  req.ruleId = xhrRules[ruleId] = ruleId;
  updateSessionRules(ruleId, {
    tabIds: [-1/*chrome.tabs.TAB_ID_NONE*/],
    urlFilter: '|' + xhrUrl + '|',
  }, {
    type: 'modifyHeaders',
    requestHeaders: vmHeaders,
  });
}

/** @param {GMReq.BG} req */
function clearRequest({ id, coreId, resolve, ruleId }) {
  delete verify[coreId];
  delete requests[id];
  delete xhrRules[ruleId];
  if (ruleId) updateSessionRules([ruleId]);
  toggleHeaderInjector(id, false);
  resolve?.();
}

export function clearRequestsByTabId(tabId, frameId) {
  requests::forEachValue(req => {
    if ((tabId == null || req.tabId === tabId)
    && (!frameId || req[kFrameId] === frameId)) {
      commands.AbortRequest(req.id);
    }
  });
}

export function reifyRequests(tabId, documentId) {
  const frameObj = getFrameDocIdAsObj(0);
  requests::forEachValue(req => {
    if (req.tabId === tabId && req[kFrameId] === documentId) {
      req[kFrameId] = 0;
      req.frame = frameObj;
    }
  });
}

/** Polyfill for browser's inability to send complex types over extension messaging */
function decodeBody([body, type, wasBlob]) {
  if (type === 'fd') {
    // FF supports FormData over messaging
    // Chrome doesn't - we use this code only with an empty FormData just to create the object
    const res = new FormData();
    body.forEach(entry => res.append(...entry));
    body = res;
    type = '';
  } else if (type === 'usp') {
    type = FORM_URLENCODED + ';' + CHARSET_UTF8;
  } else if (type != null) {
    const res = string2uint8array(undefined, body.slice(body.indexOf(',') + 1));
    if (!wasBlob) {
      type = body.match(/^data:(.+?);base64/)[1].replace(/(boundary=)[^;]+/,
        // using a function so it runs only if "boundary" was found
        (_, p1) => p1 + String.fromCharCode(...res.slice(2, res.indexOf(13))));
    }
    body = res;
  }
  return [body, type];
}

/**
 * @param {Object|chrome.declarativeNetRequest.ModifyHeaderInfo[]} res
 * @param {string} name
 * @param {string} value
 * @param {string} [nameLow]
 */
function pushHeader(res, name, value, nameLow = name) {
  if (__.MV3) {
    res.push({
      value,
      header: name,
      operation: nameLow === kCookie ? 'append' : 'set',
    });
  } else {
    res[nameLow] = { name, value };
  }
}
