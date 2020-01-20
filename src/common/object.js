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
    sub = sub[key] || (sub[key] = {});
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

export function objectPick(obj, keys, transform) {
  return keys.reduce((res, key) => {
    let value = obj?.[key];
    if (transform) value = transform(value);
    if (value != null) res[key] = value;
    return res;
  }, {});
}

// invoked as obj::mapEntry(([key, value], i, allEntries) => transformedValue)
export function mapEntry(func) {
  return Object.entries(this).reduce((res, entry, i, allEntries) => {
    res[entry[0]] = func(entry, i, allEntries);
    return res;
  }, {});
}

// invoked as obj::forEachEntry(([key, value], i, allEntries) => {})
export function forEachEntry(func) {
  if (this) Object.entries(this).forEach(func);
}

// invoked as obj::forEachKey(key => {}, i, allKeys)
export function forEachKey(func) {
  if (this) Object.keys(this).forEach(func);
}

// invoked as obj::forEachValue(value => {}, i, allValues)
export function forEachValue(func) {
  if (this) Object.values(this).forEach(func);
}
