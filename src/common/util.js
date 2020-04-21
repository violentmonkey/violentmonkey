// used in an unsafe context so we need to save the original functions
const perfNow = performance.now.bind(performance);
const { random, floor } = Math;
export const { toString: numberToString } = Number.prototype;

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

export function getRnd4() {
  return Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(-4);
}

export function getUniqId(prefix = 'VM') {
  const now = perfNow();
  return prefix
    + floor((now - floor(now)) * 1e12)::numberToString(36)
    + floor(random() * 1e12)::numberToString(36);
}

export function buffer2string(buf, offset = 0, length = 1e99) {
  // The max number of arguments varies between JS engines but it's >32k so we're safe
  const sliceSize = 8192;
  const slices = [];
  const end = Math.min(buf.byteLength, offset + length);
  for (; offset < end; offset += sliceSize) {
    slices.push(String.fromCharCode.apply(null,
      new Uint8Array(buf, offset, Math.min(sliceSize, end - offset))));
  }
  return slices.join('');
}

export function compareVersion(ver1, ver2) {
  const parts1 = (ver1 || '').split('.');
  const parts2 = (ver2 || '').split('.');
  for (let i = 0; i < parts1.length || i < parts2.length; i += 1) {
    const delta = (parseInt(parts1[i], 10) || 0) - (parseInt(parts2[i], 10) || 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
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
export const { hasOwnProperty } = Object.prototype;
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

/**
 * Make a request.
 * @param {string} url
 * @param {RequestInit} options
 * @return Promise
 */
export async function request(url, options = {}) {
  const { responseType } = options;
  const init = {
    method: options.method,
    body: options.body,
    headers: options.headers,
    credentials: options.credentials,
  };
  if (init.body && Object.prototype.toString.call(init.body) === '[object Object]') {
    init.headers = Object.assign({}, init.headers);
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const result = {};
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
  } catch {
    result.status = -1;
  }
  if (result.status > 300) throw result;
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
