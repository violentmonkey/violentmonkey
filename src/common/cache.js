import { hasOwnProperty } from '#/common/util';

export default function initCache({
  lifetime: defaultLifetime = 3000,
} = {}) {
  let cache = {};
  // setTimeout call is very expensive when done frequently,
  // 1000 calls performed for 50 scripts consume 50ms on each tab load,
  // so we'll schedule trim() just once per event loop cycle,
  // and then trim() will trim the cache and reschedule itself to the earliest expiry time.
  let timer;
  let minLifetime = -1;
  // same goes for the performance.now() used by hit() and put() which is why we expose batch(true)
  // to start an operation that reuses the same value of now(), and batch(false) to end it
  let batchStarted;
  let batchStartTime;
  // eslint-disable-next-line no-return-assign
  const getNow = () => batchStarted && batchStartTime || (batchStartTime = performance.now());
  return {
    batch, get, getValues, pop, put, del, has, hit, destroy,
  };
  function batch(enable) {
    batchStarted = enable;
    batchStartTime = 0;
  }
  function get(key, def) {
    const item = cache[key];
    return item ? item.value : def;
  }
  function getValues() {
    return Object.values(cache).map(item => item.value);
  }
  function pop(key, def) {
    const value = get(key, def);
    del(key);
    return value;
  }
  function put(key, value, lifetime = defaultLifetime) {
    if (value) {
      cache[key] = {
        value,
        expiry: lifetime + getNow(),
      };
      reschedule(lifetime);
    } else {
      delete cache[key];
    }
    return value;
  }
  function del(key) {
    delete cache[key];
  }
  function has(key) {
    return cache::hasOwnProperty(key);
  }
  function hit(key, lifetime = defaultLifetime) {
    const entry = cache[key];
    if (entry) {
      entry.expiry = lifetime + getNow();
      reschedule(lifetime);
    }
  }
  function destroy() {
    clearTimeout(timer);
    timer = 0;
    cache = {};
  }
  function reschedule(lifetime) {
    if (timer) {
      if (lifetime >= minLifetime) return;
      clearTimeout(timer);
    }
    minLifetime = lifetime;
    timer = setTimeout(trim, lifetime);
  }
  function trim() {
    // next timer won't be able to run earlier than 10ms
    // so we'll sweep the upcoming expired entries in this run
    const now = performance.now() + 10;
    let closestExpiry = Number.MAX_SAFE_INTEGER;
    for (const key in cache) {
      if (Object.hasOwnProperty.call(cache, key)) {
        const { expiry } = cache[key];
        if (expiry < now) {
          delete cache[key];
        } else if (expiry < closestExpiry) {
          closestExpiry = expiry;
        }
      }
    }
    minLifetime = closestExpiry - now;
    timer = closestExpiry < Number.MAX_SAFE_INTEGER
      ? setTimeout(trim, minLifetime)
      : 0;
  }
}
