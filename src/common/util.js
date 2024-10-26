// SAFETY WARNING! Exports used by `injected` must make ::safe() calls and use __proto__:null

import { NO_CACHE } from '@/common/consts';

export const i18n = memoize((name, args) => chrome.i18n.getMessage(name, args) || name);

export function memoize(func) {
  const cacheMap = /*@__PURE__*/Object.create(null);
  function memoized(...args) {
    const key = args.length === 1 ? `${args[0]}` : JSON.stringify(args);
    const res = cacheMap[key];
    return res !== undefined || hasOwnProperty(cacheMap, key)
      ? res
      : (cacheMap[key] = safeApply(func, this, args));
  }
  return process.env.DEV
    ? Object.defineProperty(memoized, 'name', { value: func.name + ':memoized' })
    : memoized;
}

export function debounce(func, time) {
  let startTime;
  let timer;
  let callback;
  time = Math.max(0, +time || 0);
  function checkTime() {
    timer = null;
    if (performance.now() >= startTime) callback();
    else checkTimer();
  }
  function checkTimer() {
    if (!timer) {
      const delta = startTime - performance.now();
      timer = setTimeout(checkTime, delta);
    }
  }
  function debouncedFunction(...args) {
    startTime = performance.now() + time;
    callback = () => {
      callback = null;
      func.apply(this, args);
    };
    checkTimer();
  }
  return debouncedFunction;
}

export function throttle(func, time) {
  let lastTime = 0;
  time = Math.max(0, +time || 0);
  function throttledFunction(...args) {
    const now = performance.now();
    if (lastTime + time < now) {
      lastTime = now;
      func.apply(this, args);
    }
  }
  return throttledFunction;
}

export function noop() {}

export function getRandomString(minLength = 10, maxLength = 0) {
  for (let rnd = ''; (rnd += Math.random().toString(36).slice(2));) {
    if (rnd.length >= minLength) return maxLength ? rnd.slice(0, maxLength) : rnd;
  }
}

export function getUniqId(prefix = 'VM') {
  return prefix + getRandomString();
}

/**
 * @param {ArrayBuffer|Uint8Array|Array} buf
 * @param {number} [offset]
 * @param {number} [length]
 * @return {string} a binary string i.e. one byte per character
 */
export function buffer2string(buf, offset = 0, length = 1e99) {
  // The max number of arguments varies between JS engines but it's >32k so we're safe
  const sliceSize = 8192;
  const slices = [];
  const arrayLen = buf.length; // present on Uint8Array/Array
  const end = Math.min(arrayLen || buf.byteLength, offset + length);
  const needsSlicing = arrayLen == null || offset || end > sliceSize;
  for (; offset < end; offset += sliceSize) {
    slices.push(String.fromCharCode.apply(null,
      needsSlicing
        ? new Uint8Array(buf, offset, Math.min(sliceSize, end - offset))
        : buf));
  }
  return slices.join('');
}

/**
 * Faster than buffer2string+btoa: 2x in Chrome, 10x in FF
 * @param {Blob} blob
 * @param {number} [offset]
 * @param {number} [length]
 * @return {Promise<string>} base64-encoded contents
 */
export function blob2base64(blob, offset = 0, length = 1e99) {
  if (offset || length < blob.size) {
    blob = blob.slice(offset, offset + length);
  }
  return !blob.size ? '' : new Promise(resolve => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => {
      const res = reader.result;
      resolve(res.slice(res.indexOf(',') + 1));
    };
  });
}

export function dataUri2text(url) {
  const i = url.indexOf(','); // a non-base64 data: uri may have many `,`
  const meta = url.slice(0, i);
  url = decodeURIComponent(url.slice(i + 1));
  url = /(^|;)\s*base64\s*(;|$)/.test(meta) ? atob(url) : url;
  return /[\x80-\xFF]/.test(url)
    ? new TextDecoder().decode(string2uint8array(url))
    : url;
}

export function string2uint8array(str) {
  const len = str.length;
  const array = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    array[i] = str.charCodeAt(i);
  }
  return array;
}

const VERSION_RE = /^(.*?)-([-.0-9a-z]+)|$/i;
const DIGITS_RE = /^\d+$/; // using regexp to avoid +'1e2' being parsed as 100

/** @return -1 | 0 | 1 */
export function compareVersion(ver1, ver2) {
  // Used in safe context
  // eslint-disable-next-line no-restricted-syntax
  const [, main1 = ver1 || '', pre1] = VERSION_RE.exec(ver1);
  // eslint-disable-next-line no-restricted-syntax
  const [, main2 = ver2 || '', pre2] = VERSION_RE.exec(ver2);
  const delta = compareVersionChunk(main1, main2)
    || !pre1 - !pre2 // 1.2.3-pre-release is less than 1.2.3
    || pre1 && compareVersionChunk(pre1, pre2, true); // if pre1 is present, pre2 is too
  return delta < 0 ? -1 : +!!delta;
}

function compareVersionChunk(ver1, ver2, isSemverMode) {
  const parts1 = ver1.split('.');
  const parts2 = ver2.split('.');
  const len1 = parts1.length;
  const len2 = parts2.length;
  const len = (isSemverMode ? Math.min : Math.max)(len1, len2);
  let delta;
  for (let i = 0; !delta && i < len; i += 1) {
    const a = parts1[i];
    const b = parts2[i];
    if (isSemverMode) {
      delta = DIGITS_RE.test(a) && DIGITS_RE.test(b)
        ? a - b
        : a > b || a < b && -1;
    } else {
      delta = (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);
    }
  }
  return delta || isSemverMode && (len1 - len2);
}

const units = [
  ['min', 60],
  ['h', 24],
  ['d', 1000, 365],
  ['y'],
];
export function formatTime(duration) {
  duration /= 60 * 1000;
  const unitInfo = units.find((item) => {
    const max = item[1];
    if (!max || duration < max) return true;
    const step = item[2] || max;
    duration /= step;
    return false;
  });
  return `${duration | 0}${unitInfo[0]}`;
}

export function formatByteLength(len, noBytes) {
  if (!len) return '';
  if (len < 1024 && !noBytes) return `${len} B`;
  if ((len /= 1024) < 1024) return `${Math.round(len)} k`;
  return `${+(len / 1024).toFixed(1)} M`;
}

// Used by `injected`
export function isEmpty(obj) {
  for (const key in obj) {
    if (hasOwnProperty(obj, key)) {
      return false;
    }
  }
  return true;
}

export function ensureArray(data) {
  return Array.isArray(data) ? data : [data];
}

const binaryTypes = [
  'blob',
  'arraybuffer',
];

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
    xhr.open('GET', url, true);
    if (binaryTypes.includes(responseType)) xhr[kResponseType] = responseType;
    xhr.onload = () => {
      // status for `file:` protocol will always be `0`
      result.status = xhr.status || 200;
      result.data = xhr[binaryTypes.includes(responseType) ? kResponse : kResponseText];
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

const isDataUriRe = /^data:/i;
const isHttpOrHttpsRe = /^https?:\/\//i;
const isLocalUrlRe = re`/^(
  file:|
  about:|
  data:|
  https?:\/\/
    ([^@/]*@)?
    (
      localhost|
      127\.0\.0\.1|
      (192\.168|172\.16|10\.0)\.\d+\.\d+|
      \[(::1|(fe80|fc00)::[.:0-9a-f]+)]|
      [^/:]+\.(test|example|invalid|localhost)
    )
    (:\d+|\/|$)
)/ix`;
/** Cherry-picked from https://greasyfork.org/en/help/cdns */
export const isCdnUrlRe = re`/^https:\/\/(
  (\w+-)?cdn(js)?(-\w+)?\.[^/]+ |
  bundle\.run |
  (www\.)?gitcdn\.\w+ |
  (
    ajax\.aspnetcdn |
    apis\.google |
    apps\.bdimg |
    caiyunapp |
    code\.(bdstatic | jquery) |
    kit\.fontawesome |
    lib\.baomitu |
    libs\.baidu |
    npm\.elemecdn |
    registry\.npmmirror |
    static\.(hdslb | yximgs) |
    uicdn\.toast |
    unpkg |
    www\.(gstatic | layuicdn) |
    \w+\.googleapis
  )\.com |
  (
    bowercdn |
    craig\.global\.ssl\.fastly
  )\.net |
  [^/.]+\.(
    github\.(io | com) |
    zstatic\.net
  )
)\//ix`;
export const isDataUri = /*@__PURE__*/isDataUriRe.test.bind(isDataUriRe);
export const isValidHttpUrl = url => isHttpOrHttpsRe.test(url) && tryUrl(url);
export const isRemote = url => url && !isLocalUrlRe.test(decodeURI(url));

/** @returns {string|undefined} */
export function tryUrl(str, base) {
  try {
    if (str ?? base) {
      return new URL(str, base).href; // throws on invalid urls
    }
  } catch (e) {
    // undefined
  }
}

/**
 * Make a request.
 * @param {string} url
 * @param {VMReq.Options} options
 * @return {Promise<VMReq.Response>}
 */
export async function request(url, options = {}) {
  // fetch supports file:// since Chrome 99 but we use XHR for consistency
  if (url.startsWith('file:')) return requestLocalFile(url, options);
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
  let result = { url, status: -1 };
  try {
    const urlNoAuth = auth ? scheme + hostname + urlTail : url;
    const resp = await fetch(urlNoAuth, init);
    const loadMethod = {
      arraybuffer: 'arrayBuffer',
      blob: 'blob',
      json: 'json',
    }[responseType] || 'text';
    // status for `file:` protocol will always be `0`
    result.status = resp.status || 200;
    result.headers = resp.headers;
    result.data = await resp[loadMethod]();
  } catch (err) {
    result = Object.assign(err, result);
    result.message += '\n' + url;
  }
  if (result.status < 0 || result.status > 300) throw result;
  return result;
}

// Used by `injected`
const SIMPLE_VALUE_TYPE = {
  __proto__: null,
  string: 's',
  number: 'n',
  boolean: 'b',
};

// Used by `injected`
export function dumpScriptValue(value, jsonDump = JSON.stringify) {
  if (value !== undefined) {
    const simple = SIMPLE_VALUE_TYPE[typeof value];
    return `${simple || 'o'}${simple ? value : jsonDump(value)}`;
  }
}

export function normalizeTag(tag) {
  return tag.replace(/[^\w.-]/g, '');
}

export function escapeStringForRegExp(str) {
  return str.replace(/[\\.?+[\]{}()|^$]/g, '\\$&');
}
