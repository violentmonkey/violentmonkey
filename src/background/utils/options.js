import { debounce, ensureArray, initHooks, normalizeKeys } from '#/common';
import { deepCopy, deepEqual, mapEntry, objectGet, objectSet } from '#/common/object';
import defaults from '#/common/options-defaults';
import { preInitialize } from './init';
import { commands } from './message';

Object.assign(commands, {
  /** @return {Object} */
  GetAllOptions() {
    return commands.GetOptions(defaults);
  },
  /** @return {Object} */
  GetOptions(data) {
    return data::mapEntry(([key]) => getOption(key));
  },
  /** @return {void} */
  SetOptions(data) {
    ensureArray(data).forEach(item => setOption(item.key, item.value));
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
let changes = {};
let options = {};
let initPending = browser.storage.local.get(STORAGE_KEY)
.then(({ options: data }) => {
  if (data && typeof data === 'object') options = data;
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

function fireChange(keys, value) {
  // Flattening key path so the subscribers can update nested values without overwriting the parent
  const key = keys.join('.');
  // Ensuring the correct order when updates were mixed like this: foo.bar=1; foo={bar:2}; foo.bar=3
  delete changes[key];
  changes[key] = value;
  callHooksLater();
}

function callHooks() {
  hooks.fire(changes);
  changes = {};
}

export function getOption(key, def) {
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  const value = options[mainKey] ?? deepCopy(defaults[mainKey]) ?? def;
  return keys.length > 1 ? objectGet(value, keys.slice(1), def) : value;
}

export async function setOption(key, value) {
  if (initPending) await initPending;
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  if (!defaults::hasOwnProperty(mainKey)) {
    if (process.env.DEBUG) console.info('Unknown option:', keys.join('.'), value, options);
    return;
  }
  const subKey = keys.length > 1 && keys.slice(1);
  const mainVal = getOption([mainKey]);
  if (deepEqual(value, subKey ? objectGet(mainVal, subKey) : mainVal)) {
    if (process.env.DEBUG) console.info('Option unchanged:', keys.join('.'), value, options);
    return;
  }
  options[mainKey] = subKey ? objectSet(mainVal, subKey, value) : value;
  omitDefaultValue(mainKey);
  writeOptionsLater();
  fireChange(keys, value);
  if (process.env.DEBUG) console.info('Options updated:', keys.join('.'), value, options);
}

function writeOptions() {
  return browser.storage.local.set({ [STORAGE_KEY]: options });
}

function omitDefaultValue(key) {
  return deepEqual(options[key], defaults[key])
    && delete options[key];
}

export const hookOptions = hooks.hook;
