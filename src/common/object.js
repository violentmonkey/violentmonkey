/* SAFETY WARNING! Exports used by `injected` must make ::safe() calls,
   when accessed after the initial event loop task in `injected/web`
   or after the first content-mode userscript runs in `injected/content` */

export const {
  assign,
  defineProperty,
  getOwnPropertyDescriptor: describeProperty,
  entries: objectEntries,
  keys: objectKeys,
  values: objectValues,
} = Object;
const { forEach, reduce } = Array.prototype;

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

/**
 * @param {{}} obj
 * @param {string[]} keys
 * @param {function(value,key):?} [transform]
 * @returns {{}}
 */
export function objectPick(obj, keys, transform) {
  return keys::reduce((res, key) => {
    let value = obj?.[key];
    if (transform) value = transform(value, key);
    if (value != null) res[key] = value;
    return res;
  }, {});
}

// invoked as obj::mapEntry(([key, value], i, allEntries) => transformedValue)
export function mapEntry(func) {
  return objectEntries(this)::reduce((res, entry, i, allEntries) => {
    res[entry[0]] = func(entry, i, allEntries);
    return res;
  }, {});
}

// invoked as obj::forEachEntry(([key, value], i, allEntries) => {})
export function forEachEntry(func) {
  if (this) objectEntries(this)::forEach(func);
}

// invoked as obj::forEachKey(key => {}, i, allKeys)
export function forEachKey(func) {
  if (this) objectKeys(this)::forEach(func);
}

// invoked as obj::forEachValue(value => {}, i, allValues)
export function forEachValue(func) {
  if (this) objectValues(this)::forEach(func);
}

// Needed for Firefox's browser.storage API which fails on Vue observables
export function deepCopy(src) {
  return src && (
    Array.isArray(src) && src.map(deepCopy)
    || typeof src === 'object' && src::mapEntry(([, val]) => deepCopy(val))
  ) || src;
}

// Simplified deep equality checker
export function deepEqual(a, b) {
  let res;
  if (!a || !b || typeof a !== typeof b || typeof a !== 'object') {
    res = a === b;
  } else if (Array.isArray(a)) {
    res = a.length === b.length
      && a.every((item, i) => deepEqual(item, b[i]));
  } else {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    res = keysA.length === keysB.length
      && keysA.every(key => keysB.includes(key) && deepEqual(a[key], b[key]));
  }
  return res;
}
