import {
  debounce, ensureArray, initHooks, normalizeKeys,
} from '#/common';
import { mapEntry, objectGet, objectSet } from '#/common/object';
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

let changes = {};
const hooks = initHooks();
const callHooksLater = debounce(callHooks, 100);

let options = {};
let initPending = browser.storage.local.get('options')
.then(({ options: data }) => {
  if (data && typeof data === 'object') options = data;
  if (process.env.DEBUG) {
    console.log('options:', options); // eslint-disable-line no-console
  }
  if (!objectGet(options, 'version')) {
    setOption('version', 1);
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
  let value = options[mainKey];
  if (value == null) value = defaults[mainKey];
  if (value == null) value = def;
  return keys.length > 1 ? objectGet(value, keys.slice(1), def) : value;
}

export function getDefaultOption(key) {
  return objectGet(defaults, key);
}

export function setOption(key, value) {
  if (initPending) {
    initPending.then(() => {
      setOption(key, value);
    });
    return;
  }
  const keys = normalizeKeys(key);
  const optionKey = keys.join('.');
  let optionValue = value;
  const mainKey = keys[0];
  if (mainKey in defaults) {
    if (keys.length > 1) {
      optionValue = objectSet(getOption(mainKey), keys.slice(1), value);
    }
    options[mainKey] = optionValue;
    browser.storage.local.set({ options });
    fireChange(keys, value);
    if (process.env.DEBUG) {
      console.log('Options updated:', optionKey, value, options); // eslint-disable-line no-console
    }
  }
}

export const hookOptions = hooks.hook;
