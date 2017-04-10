export default function initCache(options) {
  const cache = {};
  const { lifetime: defaultLifetime } = options || {
    lifetime: 3000,
  };
  return { get, put, del, has };
  function get(key, def) {
    const item = cache[key];
    return item ? item.value : def;
  }
  function put(key, value, lifetime = defaultLifetime) {
    del(key);
    if (value) {
      cache[key] = {
        value,
        timer: lifetime > 0 && setTimeout(del, lifetime, key),
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
}
