/* SAFETY WARNING! Exports used by `injected` must make ::safe() calls,
   when accessed after the initial event loop task in `injected/web`
   or after the first content-mode userscript runs in `injected/content` */

import { browser } from '#/common/consts';

// used in an unsafe context so we need to save the original functions
const perfNow = performance.now.bind(performance);
const { random, floor } = Math;
export const { toString: numberToString } = 0;

export function i18n(name, args) {
  return browser.i18n.getMessage(name, args) || name;
}

export function toString(param) {
  if (param == null) return '';
  return `${param}`;
}

export function memoize(func, resolver = toString) {
  const cacheMap = {};
  function memoized(...args) {
    const key = resolver(...args);
    let cache = cacheMap[key];
    if (!cache) {
      cache = {
        value: func.apply(this, args),
      };
      cacheMap[key] = cache;
    }
    return cache.value;
  }
  return memoized;
}

export function debounce(func, time) {
  let startTime;
  let timer;
  let callback;
  time = Math.max(0, +time || 0);
  function checkTime() {
    timer = null;
    if (perfNow() >= startTime) callback();
    else checkTimer();
  }
  function checkTimer() {
    if (!timer) {
      const delta = startTime - perfNow();
      timer = setTimeout(checkTime, delta);
    }
  }
  function debouncedFunction(...args) {
    startTime = perfNow() + time;
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
    const now = perfNow();
    if (lastTime + time < now) {
      lastTime = now;
      func.apply(this, args);
    }
  }
  return throttledFunction;
}

export function noop() {}

export function getUniqId(prefix = 'VM') {
  const now = perfNow();
  return prefix
    + floor((now - floor(now)) * 1e12)::numberToString(36)
    + floor(random() * 1e12)::numberToString(36);
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
  const [, main1 = ver1 || '', pre1] = VERSION_RE.exec(ver1);
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

// used in an unsafe context so we need to save the original functions
export const { hasOwnProperty } = {};
export function isEmpty(obj) {
  for (const key in obj) {
    if (obj::hasOwnProperty(key)) {
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
export async function requestLocalFile(url, options = {}) {
  // only GET method is allowed for local files
  // headers is meaningless
  return new Promise((resolve, reject) => {
    const result = {};
    const xhr = new XMLHttpRequest();
    const { responseType } = options;
    xhr.open('GET', url, true);
    if (binaryTypes.includes(responseType)) xhr.responseType = responseType;
    xhr.onload = () => {
      // status for `file:` protocol will always be `0`
      result.status = xhr.status || 200;
      result.data = binaryTypes.includes(responseType) ? xhr.response : xhr.responseText;
      if (responseType === 'json') {
        try {
          result.data = JSON.parse(result.data);
        } catch {
          // ignore invalid JSON
        }
      }
      if (result.status > 300) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    xhr.onerror = () => {
      result.status = -1;
      reject(result);
    };
    xhr.send();
  });
}

/**
 * Excludes `text/html` to avoid LINK header that Chrome uses to prefetch js and css,
 * because GreasyFork's 404 error response causes CSP violations in console of our page.
 */
const FORCED_ACCEPT = {
  'greasyfork.org': 'application/javascript, text/plain, text/css',
};
/** @typedef {{
  url: string
  status: number
  headers: Headers
  data: string|ArrayBuffer|Blob|Object
}} VMRequestResponse */
/**
 * Make a request.
 * @param {string} url
 * @param {RequestInit} options
 * @return Promise<VMRequestResponse>
 */
export async function request(url, options = {}) {
  // fetch does not support local file
  if (url.startsWith('file://')) return requestLocalFile(url, options);
  const { body, credentials, headers, method, responseType } = options;
  const isBodyObj = body && body::({}).toString() === '[object Object]';
  const hostname = url.split('/', 3)[2];
  const accept = FORCED_ACCEPT[hostname];
  const init = {
    credentials,
    method,
    body: isBodyObj ? JSON.stringify(body) : body,
    headers: isBodyObj || accept
      ? Object.assign({},
        headers,
        isBodyObj && { 'Content-Type': 'application/json' },
        accept && { accept })
      : headers,
  };
  const result = { url, status: -1 };
  try {
    const resp = await fetch(url, init);
    const loadMethod = {
      arraybuffer: 'arrayBuffer',
      blob: 'blob',
      json: 'json',
    }[responseType] || 'text';
    // status for `file:` protocol will always be `0`
    result.status = resp.status || 200;
    result.headers = resp.headers;
    result.data = await resp[loadMethod]();
  } catch { /* NOP */ }
  if (result.status < 0 || result.status > 300) throw result;
  return result;
}

const SIMPLE_VALUE_TYPE = {
  string: 's',
  number: 'n',
  boolean: 'b',
};

export function dumpScriptValue(value, jsonDump = JSON.stringify) {
  if (value !== undefined) {
    const simple = SIMPLE_VALUE_TYPE[typeof value];
    return `${simple || 'o'}${simple ? value : jsonDump(value)}`;
  }
}
