export function normalizeKeys(key) {
  if (key == null) return [];
  if (Array.isArray(key)) return key;
  return `${key}`.split('.').filter(Boolean);
}

export function objectGet(obj, rawKey, def) {
  const keys = normalizeKeys(rawKey);
  let res = obj;
  keys.every((key) => {
    if (res && typeof res === 'object' && (key in res)) {
      res = res[key];
      return true;
    }
    res = def;
    return false;
  });
  return res;
}

export function objectSet(obj, rawKey, val) {
  const keys = normalizeKeys(rawKey);
  if (!keys.length) return val;
  const root = obj || {};
  let sub = root;
  const lastKey = keys.pop();
  keys.forEach((key) => {
    sub = sub[key] || (sub[key] = /^\d+$/.test(key) ? [] : {});
  });
  if (typeof val === 'undefined') {
    delete sub[lastKey];
  } else {
    sub[lastKey] = val;
  }
  return root;
}

export function objectPurify(obj) {
  // Remove keys with undefined values
  if (Array.isArray(obj)) {
    obj.forEach(objectPurify);
  } else if (obj && typeof obj === 'object') {
    obj::forEachEntry(([key, value]) => {
      if (typeof value === 'undefined') delete obj[key];
      else objectPurify(value);
    });
  }
  return obj;
}

export function objectPick(obj, keys) {
  return keys.reduce((res, key) => {
    const value = obj ? obj[key] : null;
    if (value != null) res[key] = value;
    return res;
  }, {});
}

// invoked as obj::mapEntry((key, value) => transformedValue)
export function mapEntry(func) {
  return Object.entries(this).reduce((res, [key, value]) => {
    res[key] = func(key, value);
    return res;
  }, {});
}

// invoked as obj::forEachEntry(([key, value]) => {})
export function forEachEntry(func) {
  if (this) Object.entries(this).forEach(func);
}

// invoked as obj::forEachKey(key => {})
export function forEachKey(func) {
  if (this) Object.keys(this).forEach(func);
}

// invoked as obj::forEachValue(value => {})
export function forEachValue(func) {
  if (this) Object.values(this).forEach(func);
}
