/** @type {boolean} */
let deepDiff;

export function normalizeKeys(key) {
  if (key == null) return [];
  if (Array.isArray(key)) return key;
  return `${key}`.split('.').filter(Boolean);
}

export function objectGet(obj, rawKey) {
  for (const key of normalizeKeys(rawKey)) {
    if (!obj || typeof obj !== 'object') break;
    obj = obj[key];
  }
  return obj;
}

/**
 * @param {Object} [obj = {}]
 * @param {string|string[]} [rawKey]
 * @param {?} [val] - if `undefined` or omitted the value is deleted
 * @param {boolean} [retParent]
 * @return {Object} the original object or the parent of `val` if retParent is set
 */
export function objectSet(obj, rawKey, val, retParent) {
  rawKey = normalizeKeys(rawKey);
  let res = obj || {};
  let key;
  for (let i = 0; (key = rawKey[i], i < rawKey.length - 1); i += 1) {
    res = res[key] || (res[key] = {});
  }
  if (val === undefined) {
    delete res[key];
  } else {
    res[key] = val;
  }
  return retParent ? res : obj;
}

/**
 * @param {{}} obj
 * @param {string[]} keys
 * @param {function(value,key):?} [transform]
 * @returns {{}}
 */
export function objectPick(obj, keys, transform) {
  const res = {};
  for (const key of keys) {
    let value = obj?.[key];
    if (transform) value = transform(value, key);
    if (value !== undefined) res[key] = value;
  }
  return res;
}

/**
 * @param {function} [fnValue] - (value, newKey, obj) => newValue
 * @param {function} [fnKey] - (key, val, obj) => newKey (if newKey is falsy the key is skipped)
 * @param {Object} [thisObj] - passed as `this` to both functions
 * @return {Object}
 */
export function mapEntry(fnValue, fnKey, thisObj) {
  const res = {};
  for (let key of Object.keys(this)) {
    const val = this[key];
    if (!fnKey || (key = thisObj::fnKey(key, val, this))) {
      res[key] = fnValue ? thisObj::fnValue(val, key, this) : val;
    }
  }
  return res;
}

// invoked as obj::forEachEntry(([key, value], i, allEntries) => {})
export function forEachEntry(func, thisObj) {
  if (this) Object.entries(this).forEach(func, thisObj);
}

// invoked as obj::forEachKey(key => {}, i, allKeys)
export function forEachKey(func, thisObj) {
  if (this) Object.keys(this).forEach(func, thisObj);
}

// invoked as obj::forEachValue(value => {}, i, allValues)
export function forEachValue(func, thisObj) {
  if (this) Object.values(this).forEach(func, thisObj);
}

export function deepCopy(src) {
  if (!src || typeof src !== 'object') return src;
  /* Not using `map` because its result belongs to the `window` of the source,
   * so it becomes "dead object" in Firefox after GC collects it. */
  if (Array.isArray(src)) return Array.from(src, deepCopy);
  return src::mapEntry(deepCopy);
}

// Simplified deep equality checker
export function deepEqual(a, b) {
  let res;
  if (!a || !b || typeof a !== typeof b || typeof a !== 'object') {
    res = a === b;
  } else if (Array.isArray(a)) {
    res = a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  } else {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    res = keysA.length === keysB.length
      && keysA.every(key => keysB.includes(key) && deepEqual(a[key], b[key]));
  }
  return res;
}

/** @return {?} `undefined` if equal */
export function deepCopyDiff(src, sample) {
  if (src === sample) return;
  if (!src || typeof src !== 'object') return src;
  if (!sample || typeof sample !== 'object') return deepCopy(src);
  if ((deepDiff = false, src = deepCopyDiffObjects(src, sample), deepDiff)) return src;
}

function deepCopyDiffObjects(src, sample) {
  const isArr = Array.isArray(src);
  const arr1 = isArr ? src : Object.keys(src);
  const arr2 = isArr ? sample : Object.keys(sample);
  const res = isArr ? [] : {};
  if (arr1.length !== arr2.length) {
    deepDiff = true;
  }
  for (let i = 0, key, a, b; i < arr1.length; i += 1) {
    key = isArr ? i : arr1[i];
    a = src[key];
    b = isArr || arr2.includes(key) ? sample[key] : !a;
    if (a && typeof a === 'object') {
      if (b && typeof b === 'object') {
        a = deepCopyDiffObjects(a, b);
      } else {
        a = deepCopy(a);
        deepDiff = true;
      }
    } else if (a !== b) {
      deepDiff = true;
    }
    res[key] = a;
  }
  return res;
}

export function deepSize(val) {
  if (val === undefined) return 0;
  if (val === true || val == null) return 4;
  if (val === false) return 5;
  if (typeof val === 'string') return val.length + 2; // not counting escapes for \n\r\t and so on
  if (typeof val !== 'object') return `${val}`.length; // number and whatever
  if (Array.isArray(val)) return val.reduce((sum, v) => sum + 1 + deepSize(v), 2);
  return Object.keys(val).reduce((sum, k) => sum + k.length + 4 + deepSize(val[k]), 2);
}
