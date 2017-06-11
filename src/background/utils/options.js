import { initHooks, debounce, normalizeKeys, object } from 'src/common';
import storage from 'localStorage';   // eslint-disable-line import/no-extraneous-dependencies

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
  const value = storage.getItem(mainKey);
  let obj;
  if (value) {
    try {
      obj = JSON.parse(value);
    } catch (e) {
      // ignore invalid JSON
    }
  }
  if (obj == null) obj = defaults[mainKey];
  if (obj == null) obj = def;
  return keys.length > 1 ? object.get(obj, keys.slice(1), def) : obj;
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
    storage.setItem(mainKey, JSON.stringify(optionValue));
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
