import { isCdnUrlRe, isDataUri, isRemote, keepAlive, makeRaw, tryUrl } from '@/common';
import { NO_CACHE, VM_HOME } from '@/common/consts';
import limitConcurrency from '@/common/limit-concurrency';
import { addOwnCommands } from './init';
import callOffscreen from './offscreen';
import { testBlacklistNet } from './tester';

export const requestLimited = limitConcurrency(request, 4, 100, 1000,
  url => url.split('/')[2] // simple extraction of the `host` part
);
const binaryTypes = {
  __proto__: null,
  blob: 'blob',
  arraybuffer: 'arrayBuffer',
};
const wrqCheckEvents = ['onErrorOccurred', 'onCompleted'];

addOwnCommands({
  async Request({ url, vet, ...opts }) {
    const vettedUrl = vet ? vetUrl(url) : url;
    const fn = isRemote(vettedUrl) && !isCdnUrlRe.test(vettedUrl)
      ? requestLimited
      : request;
    const res = await fn(vettedUrl, opts);
    return opts[kResponseType] === 'blob'
      ? makeRaw(res)
      : res.data; // TODO: if we ever need headers, send it as [...headers] to make it transferable
  },
});

/**
 * Make a request.
 * @param {string} url
 * @param {VMReq.Options} options
 * @return {Promise<VMReq.Response>}
 */
export async function request(url, options = {}) {
  // fetch supports file:// since Chrome 99 but we use XHR for consistency
  if (!__.MV3 && url.startsWith('file:')) return requestLocalFile(url, options);
  const { body, headers, [kResponseType]: responseType } = options;
  const isBodyObj = body && body::({}).toString() === '[object Object]';
  const [, scheme, auth, hostname, urlTail] = url.match(/^([-\w]+:\/\/)([^@/]*@)?([^/]*)(.*)|$/);
  // Avoiding LINK header prefetch of js in 404 pages which cause CSP violations in our console
  // TODO: toggle a webRequest/declarativeNetRequest rule to strip LINK headers
  const accept = (hostname === 'greasyfork.org' || hostname === 'sleazyfork.org')
    && 'application/javascript, text/plain, text/css';
  const init = Object.assign({}, !isRemote(url) && NO_CACHE, options, {
    body: isBodyObj ? JSON.stringify(body) : body,
    headers: isBodyObj || accept || auth
      ? Object.assign({},
        headers,
        isBodyObj && { 'Content-Type': 'application/json' },
        auth && { Authorization: `Basic ${btoa(decodeURIComponent(auth.slice(0, -1)))}` },
        accept && { accept })
      : headers,
  });
  const urlNoAuth = auth ? scheme + hostname + urlTail : url;
  const loadMethod = binaryTypes[responseType]
    || (responseType === 'json' ? responseType : 'text');
  const keeper = __.MV3 && keepAlive();
  const errCheck = __.MV3 && url.startsWith('https') && (info => {
    if (info.tabId === -1 && info.initiator === extensionOrigin) {
      errCheckLock.resolve(info.error);
    }
  });
  const errCheckLock = errCheck && Promise.withResolvers();
  let status = -1;
  let result = { url };
  if (errCheck) for (const evt of wrqCheckEvents) {
    chrome.webRequest[evt].addListener(errCheck, { types: ['xmlhttprequest'], urls: [url] });
  }
  try {
    const resp = await fetch(urlNoAuth, init);
    // status for `file:` protocol will always be `0`
    status = resp.status || 200;
    result.headers = resp.headers;
    result.data = await resp[loadMethod]();
  } catch (err) {
    if (errCheck && /cert/i.test(await errCheckLock.promise)) {
      try {
        // Service worker in MV3 can't fetch from a URL with an invalid certificate
        Object.assign(result, await callOffscreen('Fetch', [urlNoAuth, init, loadMethod]));
        result.headers = new Headers(result.headers);
        status = result.status;
        err = false; // eslint-disable-line no-ex-assign
      } catch {/*keep `err`*/
      }
    }
    if (err || !__.MV3) {
      result = Object.assign(err, result);
      result.message += (status > 0 ? ` (HTTP ${status})` : ' (could not connect)') + '\n' + url;
    }
  }
  if (errCheck) for (const evt of wrqCheckEvents) chrome.webRequest[evt].removeListener(errCheck);
  if (__.MV3) keeper();
  result.status = status;
  if (status < 0 || status > 300) throw result;
  return result;
}

/**
 * @param {string} url
 * @param {VMReq.Options} options
 * @return {Promise<VMReq.Response>}
 */
export async function requestLocalFile(url, options = {}) {
  // only GET method is allowed for local files
  // headers is meaningless
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    /** @type {VMReq.Response} */
    const result = {
      headers: {
        get: name => xhr.getResponseHeader(name),
      },
      url,
    };
    const { [kResponseType]: responseType } = options;
    const binary = binaryTypes[responseType];
    xhr.open('GET', url, true);
    if (binary) xhr[kResponseType] = responseType;
    xhr.onload = () => {
      // status for `file:` protocol will always be `0`
      result.status = xhr.status || 200;
      result.data = xhr[binary ? kResponse : kResponseText];
      if (responseType === 'json') {
        try {
          result.data = JSON.parse(result.data);
        } catch {
          // ignore invalid JSON
        }
      }
      resolve(result);
    };
    xhr.onerror = () => {
      result.status = -1;
      reject(result);
    };
    xhr.send();
  });
}

/**
 * @param {string} url
 * @param {string} [base]
 * @param {boolean} [throwOnFailure]
 * @returns {string} a resolved `url` or `data:,Invalid URL ${url}`
 */
export function vetUrl(url, base = VM_HOME, throwOnFailure) {
  let res, err;
  if (isDataUri(url)) {
    res = url;
  } else {
    res = tryUrl(url, base);
    err = !res ? 'Invalid'
      : (res.startsWith(extensionRoot) || testBlacklistNet(res)) && 'Blacklisted';
    if (err) {
      err = `${err} URL ${res || url}`;
      if (throwOnFailure) throw err;
      res = `data:,${err}`;
    }
  }
  return res;
}
