import { debounce, initHooks, normalizeKeys, sendCmd } from '@/common';
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

export function initOptions(data) {
  data = data[kOptions] || {};
  Object.assign(options, data);
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
  const value = options[mainKey] ?? deepCopy(defaults[mainKey]);
  return keys.length > 1 ? objectGet(value, keys.slice(1)) : value;
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
  options[mainKey] = subKey ? objectSet(mainVal, subKey, value) : value;
  omitDefaultValue(mainKey);
  writeOptionsLater();
  addChange(key, value, silent);
  if (process.env.DEBUG) console.info('Options updated:', key, value, options);
}

function writeOptions() {
  return storage.base.setOne(kOptions, options);
}

function omitDefaultValue(key) {
  return deepEqual(options[key], defaults[key])
    && delete options[key];
}
