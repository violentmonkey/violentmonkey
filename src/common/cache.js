export default function initCache({
  lifetime: defaultLifetime = 3000,
  onDispose,
} = {}) {
  let cache = Object.create(null);
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
  const OVERRUN = 1000; // in ms, to reduce frequency of calling setTimeout
  const exports = {
    batch, get, some, pop, put, del, has, hit, destroy,
  };
  if (process.env.DEV) Object.defineProperty(exports, 'data', { get: () => cache });
  return exports;
  function batch(enable) {
    batchStarted = enable;
    batchStartTime = 0;
  }
  function get(key, def, shouldHit = true) {
    const item = cache[key];
    if (item && shouldHit) {
      reschedule(item, item.lifetime);
    }
    return item ? item.value : def;
  }
  /**
   * @param {(val:?, key:string) => void} fn
   * @param {Object} [thisObj]
   */
  function some(fn, thisObj) {
    for (const key in cache) {
      const item = cache[key];
      // Might be already deleted by fn
      if (item && fn.call(thisObj, item.value, key)) {
        return true;
      }
    }
  }
  function pop(key, def) {
    const value = get(key, def);
    del(key);
    return value;
  }
  function put(key, value, lifetime) {
    reschedule(cache[key] = lifetime ? { value, lifetime } : { value }, lifetime);
    return value;
  }
  function del(key) {
    const data = cache[key];
    if (data) {
      delete cache[key];
      onDispose?.(data.value, key);
    }
  }
  function has(key) {
    return key in cache;
  }
  function hit(key, lifetime) {
    const entry = cache[key];
    if (entry) {
      reschedule(entry, lifetime);
    }
  }
  function destroy() {
    // delete all keys to make sure onDispose is called for each value
    if (onDispose) {
      // cache inherits null so we don't need to check hasOwnProperty
      // eslint-disable-next-line guard-for-in
      for (const key in cache) {
        del(key);
      }
    } else {
      cache = Object.create(null);
    }
    clearTimeout(timer);
    timer = 0;
  }
  function reschedule(entry, lifetime = defaultLifetime) {
    entry.expiry = lifetime + getNow();
    if (timer) {
      if (lifetime >= minLifetime) return;
      clearTimeout(timer);
    }
    minLifetime = lifetime;
    timer = setTimeout(trim, lifetime + OVERRUN);
  }
  function trim() {
    const now = performance.now();
    let closestExpiry = Number.MAX_SAFE_INTEGER;
    // eslint-disable-next-line guard-for-in
    for (const key in cache) {
      const { expiry } = cache[key];
      if (expiry < now) {
        del(key);
      } else if (expiry < closestExpiry) {
        closestExpiry = expiry;
      }
    }
    minLifetime = closestExpiry - now;
    timer = closestExpiry < Number.MAX_SAFE_INTEGER
      ? setTimeout(trim, minLifetime + OVERRUN)
      : 0;
  }
}
