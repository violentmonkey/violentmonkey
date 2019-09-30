const DEFAULT_LIFETIME = 3000;

export default function initCache({
  lifetime: defaultLifetime = DEFAULT_LIFETIME,
} = {}) {
  let cache = {};
  // setTimeout call is very expensive when done frequently,
  // 1000 calls performed for 50 scripts consume 50ms on each tab load,
  // so we'll schedule trim() just once per event loop cycle,
  // and then trim() will trim the cache and reschedule itself to the earliest expiry time.
  let timer;
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
      if (!timer) timer = setTimeout(trim);
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
      if (!timer) timer = setTimeout(trim);
    }
  }
  function destroy() {
    clearTimeout(timer);
    timer = 0;
    cache = {};
  }
  function trim() {
    const now = performance.now();
    let closest = Number.MAX_SAFE_INTEGER;
    for (const key in cache) {
      if (Object.hasOwnProperty.call(cache, key)) {
        const { expiry } = cache[key];
        if (expiry < now) {
          delete cache[key];
        } else if (expiry < closest) {
          closest = expiry;
        }
      }
    }
    timer = closest === Number.MAX_SAFE_INTEGER ? 0 : setTimeout(trim, closest - now);
  }
}
