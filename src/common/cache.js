const defaults = {
  lifetime: 3000,
};

export default function initCache(options) {
  const cache = {};
  const { lifetime: defaultLifetime } = options || defaults;
  return { get, put, del, has, hit, destroy };
  function get(key, def) {
    const item = cache[key];
    return item ? item.value : def;
  }
  function put(key, value, lifetime) {
    del(key);
    if (value) {
      cache[key] = {
        value,
        timer: setTimeout(del, lifetime || defaultLifetime, key),
      };
    }
  }
  function del(key) {
    const item = cache[key];
    if (item) {
      if (item.timer) clearTimeout(item.timer);
      delete cache[key];
    }
  }
  function has(key) {
    return !!cache[key];
  }
  function hit(key, lifetime) {
    put(key, get(key), lifetime);
  }
  function destroy() {
    Object.keys(cache).forEach(del);
  }
}
