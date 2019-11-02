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
  return {
    get, put, del, has, hit, destroy,
  };
  function get(key, def) {
    const item = cache[key];
    return item ? item.value : def;
  }
  function put(key, value, lifetime = defaultLifetime) {
    if (value) {
      cache[key] = {
        value,
        expiry: lifetime + performance.now(),
      };
      reschedule(lifetime);
    } else {
      delete cache[key];
    }
  }
  function del(key) {
    delete cache[key];
  }
  function has(key) {
    return Object.hasOwnProperty.call(cache, key);
  }
  function hit(key, lifetime = defaultLifetime) {
    const entry = cache[key];
    if (entry) {
      entry.expiry = performance.now() + lifetime;
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
