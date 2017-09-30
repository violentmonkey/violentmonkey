import { initHooks, debounce, normalizeKeys } from 'src/common';
import { objectGet, objectSet } from 'src/common/object';
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
  notifyUpdates: false,
  version: null,
  filters: {
    sort: 'exec',
  },
};
let changes = {};
const hooks = initHooks();
const callHooksLater = debounce(callHooks, 100);

let options = {};
const init = browser.storage.local.get('options')
.then(({ options: data }) => {
  if (data && typeof data === 'object') options = data;
  if (process.env.DEBUG) {
    console.log('options:', options); // eslint-disable-line no-console
  }
  if (!objectGet(options, 'version')) {
    // v2.8.0+ stores options in browser.storage.local
    // Upgrade from v2.7.x
    if (process.env.DEBUG) {
      console.log('Upgrade options...'); // eslint-disable-line no-console
    }
    try {
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
            if (process.env.DEBUG) {
              console.log('Upgrade option:', key, value); // eslint-disable-line no-console
            }
            setOption(key, value);
          }
        });
      }
    } catch (e) {
      // ignore security issue in Firefox
    }
    setOption('version', 1);
  }
});
register(init);

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
  return keys.length > 1 ? objectGet(value, keys.slice(1), def) : value;
}

export function setOption(key, value) {
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
    fireChange(optionKey, value);
    if (process.env.DEBUG) {
      console.log('Options updated:', optionKey, value, options); // eslint-disable-line no-console
    }
  }
}

export function getAllOptions() {
  return Object.keys(defaults).reduce((res, key) => {
    res[key] = getOption(key);
    return res;
  }, {});
}

export const hookOptions = hooks.hook;
