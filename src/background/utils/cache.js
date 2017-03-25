const cache = {};

export function getCache(key) {
  const obj = cache[key];
  return obj && obj.value;
}

export function setCache(key, value) {
  if (value) {
    let obj = cache[key];
    if (!obj) {
      obj = { key };
      cache[key] = obj;
    }
    obj.value = value;
    if (obj.timer) clearTimeout(obj.timer);
    obj.timer = setTimeout(setCache, 3000, key);
  } else {
    delete cache[key];
  }
}
