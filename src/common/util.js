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
  let timer;
  function run(thisObj, args) {
    timer = null;
    func.apply(thisObj, args);
  }
  return function debouncedFunction(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, time, this, args);
  };
}

export function throttle(func, time) {
  let timer;
  function run(thisObj, args) {
    timer = null;
    func.apply(thisObj, args);
  }
  return function throttledFunction(...args) {
    if (!timer) {
      timer = setTimeout(run, time, this, args);
    }
  };
}

export function noop() {}

export function getRnd4() {
  return Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(-4);
}

export function getUniqId(prefix) {
  return (prefix || '') + Date.now().toString(36) + getRnd4();
}

export function buffer2string(buffer) {
  const array = new window.Uint8Array(buffer);
  const sliceSize = 8192;
  let str = '';
  for (let i = 0; i < array.length; i += sliceSize) {
    str += String.fromCharCode.apply(null, array.subarray(i, i + sliceSize));
  }
  return str;
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
