import { keepAlive, noop, sendTabCmd, string2uint8array } from '@/common';
import { CHARSET_UTF8, FORM_URLENCODED, UA_PROPS, UPLOAD } from '@/common/consts';
import { deepEqual, forEachEntry, forEachValue } from '@/common/object';
import { kGmDownloadViaApi } from '@/common/options-defaults';
import { initXHR } from '@/offscreen/xhr';
import { DNR, DNR_ID_XHR, updateSessionRules, xhrRules } from './dnr';
import downloadViaApi from './download-via-api';
import { addOwnCommands, addPublicCommands, commands } from './init';
import callOffscreen from './offscreen';
import { getOption } from './options';
import { permissionDownloads } from './permissions';
import {
  FORBIDDEN_HEADER_RE, kCookie, kRequestHeaders, kSetCookie, requests, toggleHeaderInjector, verify,
} from './requests-core';
import { getFrameDocIdAsObj, getFrameDocIdFromSrc } from './tabs';
import { navUA, navUAD } from './ua';
import { vetUrl } from './url';

if (__.MV3) addOwnCommands({
  XHRNotify: data => {
    requests[data.id].cb(data);
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
    const { id, events, [kFileName]: fileName } = opts;
    const req = requests[id] = /** @type {GMReq.BG} */ {
      id,
      tabId,
      [kFrameId]: frameId,
      [kFileName]: fileName,
      frame: getFrameDocIdAsObj(frameId),
    };
    /** @param {GMReq.Message.BGAny} res */
    const cb = res => {
      if (!requests[id]) return;
      const { data } = res;
      if (__.MV3 && data && req.url) {
        data.finalUrl = req.url; // from onBeforeSendHeaders
      }
      if (res.type === 'loadend' && !data?.[UPLOAD]) {
        clearRequest(req);
      }
      sendTabCmd(tabId, 'HttpRequested', res, req.frame);
    };
    const cbError = err => cb({
      id,
      [ERROR]: [err.message || `${err}`, err.name],
      data: null,
      type: ERROR,
    });
    Object.defineProperties(req, { // non-enumerable props won't be messaged
      cb: {value: cb},
      cbError: {value: cbError},
      resolve: {value: __.MV3 ? keepAlive() : noop},
    });
    return (
      fileName && permissionDownloads && getOption(kGmDownloadViaApi)
      ? downloadViaApi
      : httpRequest
    )(opts, events, id, req, src, fileName).catch(cbError);
  },
  /** @return {void | Promise<void>} */
  AbortRequest(id) {
    const req = requests[id];
    if (req) return req.dlId ? browser.downloads.cancel(req.dlId)
      : __.MV3 ? callOffscreen('XHRStop', id)
        : requests[id].xhr.abort();
  },
  // TODO: check if the content script can revoke it
  RevokeBlob: __.MV3 ? callOffscreen : URL.revokeObjectURL,
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
 * @param {string} id
 * @param {GMReq.BG} req
 * @param {VMMessageSender} src
 * -@param {string} [fileName]
 */
async function httpRequest(opts, events, id, req, src) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, overrideMimeType, [kXhrType]: xhrType } = opts;
  const url = vetUrl(opts.url, src.url, true);
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
  // Chrome MV2 & FF need explicit routing of cookies in containers or "spanning" mode incognito
  const shouldSendCookies = !__.MV3 && !anonymous && (incognito || IS_FIREFOX);
  const uaHeaders = [];
  const kOrigin = 'origin';
  let hasOriginHeader;
  let storeId;
  if (!__.MV3) {
    req[kCookie] = !anonymous && !shouldSendCookies;
    req[kSetCookie] = !anonymous;
  }
  if (contentType) xhrHeaders['Content-Type'] = contentType;
  opts.headers::forEachEntry(([name, value]) => {
    const nameLow = name.toLowerCase();
    const i = UA_HEADERS.indexOf(nameLow);
    if (i >= 0 && (uaHeaders[i] = true) || FORBIDDEN_HEADER_RE.test(name)) {
      pushHeader(vmHeaders, name, value, nameLow);
      hasOriginHeader ||= nameLow === kOrigin;
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
        if (IS_FIREFOX ? !store.id.endsWith('-default') : store.id !== '0') {
          /* Cookie routing. For the main store we rely on the browser.
           * The ids are hard-coded as `stores` may omit the main store if no such tabs are open. */
          storeId = req.storeId = store.id;
        }
        break;
      }
    }
    const now = Date.now() / 1000;
    const cookies = (await browser.cookies.getAll({
      url,
      storeId,
      ...IS_FIREFOX && { firstPartyDomain: null },
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
  if (__.MV3) {
    let responseHeaders;
    let ruleId = DNR_ID_XHR; while (xhrRules[++ruleId]) {/**/}
    req.ruleId = ruleId;
    xhrRules[ruleId] = 1;
    if (anonymous) {
      pushHeader(vmHeaders, kCookie);
      pushHeader(responseHeaders = [], kSetCookie);
    }
    if (!hasOriginHeader) {
      pushHeader(vmHeaders, kOrigin);
    }
    await DNR.updateSessionRules({
      addRules: [{
        id: ruleId,
        condition: {
          tabIds: [-1/*chrome.tabs.TAB_ID_NONE*/],
          urlFilter: '|' + xhrUrl + '|',
        },
        action: {
          type: 'modifyHeaders',
          [kRequestHeaders]: vmHeaders,
          [kResponseHeaders]: responseHeaders,
        },
      }]
    });
    await callOffscreen('XHRStart', xhrOpts);
  } else {
    initXHR(xhrOpts);
  }
}

/** @param {GMReq.BG} req */
function clearRequest({ id, coreId, resolve, ruleId }) {
  delete verify[coreId];
  delete requests[id];
  if (__.MV3) {
    delete xhrRules[ruleId];
    if (ruleId) updateSessionRules([ruleId]);
    resolve();
  }
  toggleHeaderInjector(id, false);
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
 * @param {string} [value]
 * @param {string} [nameLow]
 */
function pushHeader(res, name, value, nameLow = name) {
  if (__.MV3) {
    res.push({
      value,
      header: name,
      operation: value == null ? 'remove' : nameLow === kCookie ? 'append' : 'set',
    });
  } else {
    res[nameLow] = { name, value };
  }
}
