import { debounce, ensureArray, initHooks, normalizeKeys, sendCmd } from '@/common';
import { deepCopy, deepEqual, mapEntry, objectGet, objectSet } from '@/common/object';
import defaults from '@/common/options-defaults';
import { addOwnCommands, commands, init } from './init';
import storage from './storage';

let changes;
let options = {};

addOwnCommands({
  /** @return {Object} */
  GetAllOptions() {
    return commands.GetOptions(defaults);
  },
  /** @return {Object} */
  GetOptions(data) {
    return data::mapEntry((_, key) => getOption(key));
  },
  /**
   * @param {{key:string, value?:PlainJSONValue, reply?:boolean}|Array} data
   * @return {void}
   * @throws {?} hooks can throw after the option was set */
  SetOptions(data) {
    for (const { key, value, reply } of ensureArray(data)) {
      setOption(key, value, reply);
    }
    callHooks(); // exceptions will be sent to the caller
  },
});

const STORAGE_KEY = 'options';
const VERSION = 'version';
const TPL_KEY = 'scriptTemplate';
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
export const hookOptions = hooks.hook;
// TODO: add `keys` parameter to hookOptions
// TODO: call hooks.fire in init.then (DANGER! check usages of hookOptions+getOption)
hookOptions(changes => sendCmd('UpdateOptions', changes));

export function initOptions(data) {
  data = data[STORAGE_KEY] || {};
  if (isObject(data)) options = data;
  if (process.env.DEBUG) console.info('options:', options);
  if (!options[VERSION]) {
    setOption(VERSION, 1);
  }
  if (options[TPL_KEY] === TPL_OLD_VAL) {
    options[TPL_KEY] = defaults[TPL_KEY]; // will be detected by omitDefaultValue below
  }
  if (Object.keys(options).map(omitDefaultValue).some(Boolean)) {
    delete options[`${TPL_KEY}Edited`]; // TODO: remove this in 2023
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
  return storage.base.setOne(STORAGE_KEY, options);
}

function omitDefaultValue(key) {
  return deepEqual(options[key], defaults[key])
    && delete options[key];
}
