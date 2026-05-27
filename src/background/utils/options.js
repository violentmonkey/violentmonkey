import { compareVersion, debounce, initHooks, normalizeKeys, sendCmd } from '@/common';
import { deepCopy, deepEqual, objectGet, objectSet } from '@/common/object';
import defaults, { kScriptTemplate } from '@/common/options-defaults';
import { addOwnCommands, init } from './init';
import storage from './storage';

let changes;

addOwnCommands({
  /** @return {Object} */
  GetAllOptions() {
    return Object.assign({}, defaults, options); // eslint-disable-line no-use-before-define
  },
  /**
   * @param {{ [key:string]: PlainJSONValue }} data
   * @return {void}
   * @throws {?} hooks can throw after the option was set */
  SetOptions(data) {
    for (const key in data) setOption(key, data[key], true);
    callHooks(); // exceptions will be sent to the caller
  },
});

const options = {};
export const kOptions = 'options';
export const kVersion = 'version';
const TPL_OLD_VAL = `\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match {{url}}
// @grant none
// ==/UserScript==
`;
const DELAY = 100;
const hooks = initHooks();
const callHooksLater = debounce(callHooks, DELAY);
const writeOptionsLater = debounce(writeOptions, DELAY);
const optProxy = new Proxy(defaults, { get: (_, key) => getOption(key) });
export const hookOptions = hooks.hook;
hookOptions(data => sendCmd('UpdateOptions', data));

export function initOptions(data, lastVersion, versionChanged) {
  data = data[kOptions] || {};
  Object.assign(options, data);
  if (!options.modified) {
    options.modified = buildModified();
  }
  if (process.env.DEBUG) console.info('options:', options);
  if (!options[kVersion]) {
    setOption(kVersion, 1);
  }
  if (options[kScriptTemplate] === TPL_OLD_VAL) {
    options[kScriptTemplate] = defaults[kScriptTemplate]; // will be detected by omitDefaultValue below
  }
  if (Object.keys(options).map(omitDefaultValue).some(Boolean)) {
    delete options[`${kScriptTemplate}Edited`]; // TODO: remove this in 2023
    writeOptionsLater();
  }
  if (versionChanged) {
    let key, val;
    if (IS_FIREFOX && options[key = 'defaultInjectInto'] === PAGE
    && compareVersion(lastVersion, '2.12.7') <= 0) {
      options[key] = AUTO;
    }
    if ((val = options.filters) && val[key = 'sort'] === 'exec'
    && compareVersion(lastVersion, '2.31.2') <= 0) {
      val[key] += '-'; // Until reverse sort was implemented, 'size' was reversed by design
    }
  }
}

/**
 * @param {!string} key - must be "a.b.c" to allow clients easily set inside existing object trees
 * @param {PlainJSONValue} [value]
 * @param {boolean} [silent] - in case you callHooks() directly yourself afterwards
 */
function addChange(key, value, silent) {
  if (!changes) changes = {};
  else delete changes[key]; // Deleting first to place the new value at the end
  changes[key] = value;
  if (!silent) callHooksLater();
}

/** @throws in option handlers */
function callHooks() {
  if (!changes) return; // may happen in callHooksLater if callHooks was called earlier
  const tmp = changes;
  changes = null;
  hooks.fire(tmp);
}

/** Hooks and calls the callback with a copy of all options when init is resolved */
export function hookOptionsInit(cb) {
  if (init) init.then(() => cb(optProxy, true));
  else cb(optProxy, true);
  return hookOptions(cb);
}

export function getOption(key) {
  let res = options[key];
  if (res != null) return res;
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  const value = options[mainKey] ?? defaults[mainKey];
  return deepCopy(keys.length > 1 ? objectGet(value, keys.slice(1)) : value);
}

export function setOption(key, value, silent) {
  if (init) return init.then(setOption.bind(null, ...arguments));
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  key = keys.join('.'); // must be a string for addChange()
  if (!hasOwnProperty(defaults, mainKey)) {
    if (process.env.DEBUG) console.info('Unknown option:', key, value, options);
    return;
  }
  const subKey = keys.length > 1 && keys.slice(1);
  const mainVal = getOption([mainKey]);
  if (deepEqual(value, subKey ? objectGet(mainVal, subKey) : mainVal)) {
    if (process.env.DEBUG) console.info('Option unchanged:', key, value, options);
    return;
  }
  const now = Date.now();
  if (subKey) {
    options[mainKey] = objectSet(mainVal, subKey, value);
    options.modified[key] = now;
  } else {
    options[mainKey] = value;
    Object.assign(options.modified,
      collectChanges(mainKey, mainVal, value, now));
  }
  omitDefaultValue(mainKey);
  writeOptionsLater();
  addChange(key, value, silent);
  if (process.env.DEBUG) console.info('Options updated:', key, value, options);
}

function buildModified() {
  const modified = {};
  const now = Date.now();
  Object.keys(options).forEach((key) => {
    const newVal = options[key];
    const oldVal = hasOwnProperty(defaults, key)
      ? defaults[key] : undefined;
    if (deepEqual(oldVal, newVal))
      return;
    Object.assign(modified,
      collectChanges(key, oldVal, newVal, now));
  });
  return modified;
}

export function buildOptionsDiff() {
  const ignoredKeys = [
    'version',
    'lastModified',
    'lastUpdate',
    'sync',
  ];
  const diff = {};
  const map = options.modified;
  for (const key in map) {
    const [first] = key.split('.');
    if (ignoredKeys.includes(first))
      continue;
    const modified = map[key];
    const value = getOption(key);
    if (value === undefined)
      continue;
    diff[key] = { value, modified };
  }
  return diff;
}

export function applyOptionsDiff(diff) {
  if (!diff)
    return;
  for (const key in diff) {
    const entry = diff[key];
    const { value, modified } = entry;
    const current = getOption(key);
    if (!deepEqual(current, value))
      setOption(key, value, true);
    // always sync timestamps, even if values were equal so that
    // future merges won't treat them as conflicts again.
    options.modified[key] = modified;
  }
  callHooks();
}

export function mergeOptionsDiff(a, b) {
  const merged = {};
  const left = a || {};
  const right = b || {};
  const keys = Object.keys(
    {...left,...right }
  );
  for (const key of keys) {
    const l = left[key];
    const r = right[key];
    if (l && !r) {
      merged[key] = l;
      continue;
    }
    if (r && !l) {
      merged[key] = r;
      continue;
    }
    const lm = l.modified;
    const rm = r.modified;
    if (lm > rm) {
      merged[key] = l;
    } else if (rm > lm) {
      merged[key] = r;
    } else {
      // take right side, if timestamps are equal.
      merged[key] = r;
    }
  }
  return merged;
}

function writeOptions() {
  return storage.base.setOne(kOptions, options);
}

function omitDefaultValue(key) {
  return deepEqual(options[key], defaults[key])
    && delete options[key];
}

function collectChanges(prefix, oldVal, newVal, now) {
  const diff = {};
  if (!oldVal || typeof oldVal !== 'object' ||
      !newVal || typeof newVal !== 'object') {
    diff[prefix] = now;
    return diff;
  }
  const keys = Object.keys(oldVal);
  Object.keys(newVal).forEach((key) => {
    if (!keys.includes(key)) keys.push(key);
  });
  keys.forEach((key) => {
    const oldItem = oldVal[key];
    const newItem = newVal[key];
    if (deepEqual(oldItem, newItem))
      return;
    const path = `${prefix}.${key}`;
    if (oldItem && typeof oldItem === 'object' &&
        newItem && typeof newItem === 'object') {
      Object.assign(diff,
        collectChanges(path, oldItem, newItem, now));
    } else {
      diff[path] = now;
    }
  });
  return diff;
}
