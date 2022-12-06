import { debounce, ensureArray, initHooks, normalizeKeys } from '@/common';
import { deepCopy, deepEqual, mapEntry, objectGet, objectSet } from '@/common/object';
import defaults from '@/common/options-defaults';
import { preInitialize } from './init';
import { addOwnCommands, commands } from './message';
import storage from './storage';

let changes;
let initPending;
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
   * @return {Promise<void>}
   * @throws {?} hooks can throw after the option was set */
  async SetOptions(data) {
    if (initPending) await initPending;
    for (const { key, value, reply } of ensureArray(data)) {
      setOption(key, value, reply);
    }
    if (changes) callHooks(); // exceptions will be sent to the caller
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

initPending = storage.base.getOne(STORAGE_KEY).then(data => {
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
  initPending = null;
});
preInitialize.push(initPending);

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
  // eslint-disable-next-line prefer-rest-params
  if (initPending) return initPending.then(() => setOption(...arguments));
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

export const hookOptions = hooks.hook;
