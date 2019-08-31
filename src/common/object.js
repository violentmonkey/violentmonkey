import { normalizeKeys } from '.';

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
    let child = sub[key];
    if (!child) {
      child = {};
      sub[key] = child;
    }
    sub = child;
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
    Object.keys(obj).forEach((key) => {
      const type = typeof obj[key];
      if (type === 'undefined') delete obj[key];
      else objectPurify(obj[key]);
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
