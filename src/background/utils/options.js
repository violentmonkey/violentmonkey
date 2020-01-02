import {
  debounce, ensureArray, initHooks, normalizeKeys,
} from '#/common';
import { objectGet, objectSet, objectMap } from '#/common/object';
import defaults from '#/common/options-defaults';
import { register } from './init';
import { commands } from './message';

Object.assign(commands, {
  GetAllOptions() {
    return commands.GetOptions(defaults);
  },
  GetOptions(data) {
    return objectMap(data, key => getOption(key));
  },
  SetOptions(data) {
    ensureArray(data).forEach(item => setOption(item.key, item.value));
  },
});

let changes = {};
const hooks = initHooks();
const callHooksLater = debounce(callHooks, 100);

let options = {};
let ready = false;
const init = browser.storage.local.get('options')
.then(({ options: data }) => {
  if (data && typeof data === 'object') options = data;
  if (process.env.DEBUG) {
    console.log('options:', options); // eslint-disable-line no-console
  }
  if (!objectGet(options, 'version')) {
    setOption('version', 1);
  }
})
.then(() => {
  ready = true;
});
register(init);

function fireChange(keys, value) {
  objectSet(changes, keys, value);
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
  if (!ready) {
    init.then(() => {
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
