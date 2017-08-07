import { initHooks, debounce, normalizeKeys, object } from 'src/common';
import { register } from './init';

const defaults = {
  isApplied: true,
  autoUpdate: true,
  // ignoreGrant: false,
  lastUpdate: 0,
  showBadge: true,
  exportValues: true,
  closeAfterInstall: false,
  trackLocalFile: false,
  autoReload: false,
  features: null,
  blacklist: null,
  syncScriptStatus: true,
  sync: null,
  customCSS: null,
  importSettings: true,
  notifyUpdates: true,
};
let changes = {};
const hooks = initHooks();
const callHooksLater = debounce(callHooks, 100);

let options = {};
const init = browser.storage.local.get('options')
.then(({ options: value }) => {
  options = value;
  if (!options || typeof options !== 'object') options = {};
});
register(init);

// v2.8.0+ stores options in browser.storage.local
// Upgrade from v2.7.x
if (localStorage.length) {
  Object.keys(defaults)
  .forEach(key => {
    let value = localStorage.getItem(key);
    if (value) {
      try {
        value = JSON.parse(value);
      } catch (e) {
        value = null;
      }
    }
    if (value) {
      setOption(key, value);
    }
    localStorage.clear();
  });
}

function fireChange(key, value) {
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
  return keys.length > 1 ? object.get(value, keys.slice(1), def) : value;
}

export function setOption(key, value) {
  const keys = normalizeKeys(key);
  const optionKey = keys.join('.');
  let optionValue = value;
  const mainKey = keys[0];
  if (mainKey in defaults) {
    if (keys.length > 1) {
      optionValue = object.set(getOption(mainKey), keys.slice(1), value);
    }
    options[mainKey] = optionValue;
    browser.storage.local.set({ options });
    fireChange(optionKey, value);
  }
}

export function getAllOptions() {
  return Object.keys(defaults).reduce((res, key) => {
    res[key] = getOption(key);
    return res;
  }, {});
}

export const hookOptions = hooks.hook;
