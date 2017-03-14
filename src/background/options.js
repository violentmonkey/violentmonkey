var _ = require('src/common');

var defaults = {
  isApplied: true,
  autoUpdate: true,
  ignoreGrant: false,
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
};
var changes = {};
var hooks = _.initHooks();
var callHooksLater = _.debounce(callHooks, 100);

function fireChange(key, value) {
  changes[key] = value;
  callHooksLater();
}

function callHooks() {
  hooks.fire(changes);
  changes = {};
}

function getOption(key, def) {
  var keys = _.normalizeKeys(key);
  key = keys[0];
  var value = localStorage.getItem(key), obj;
  if (value) {
    try {
      obj = JSON.parse(value);
    } catch (e) {
      // ignore invalid JSON
    }
  }
  if (obj == null) obj = defaults[key];
  if (obj == null) obj = def;
  return keys.length > 1 ? _.object.get(obj, keys.slice(1), def) : obj;
}

function setOption(key, value) {
  var keys = _.normalizeKeys(key);
  var optionKey = keys.join('.');
  var optionValue = value;
  key = keys[0];
  if (key in defaults) {
    if (keys.length > 1) {
      optionValue = _.object.set(getOption(key), keys.slice(1), value);
    }
    localStorage.setItem(key, JSON.stringify(optionValue));
    fireChange(optionKey, value);
  }
}

function getAllOptions() {
  return Object.keys(defaults).reduce(function (res, key) {
    res[key] = getOption(key);
    return res;
  }, {});
}

module.exports = {
  get: getOption,
  set: setOption,
  getAll: getAllOptions,
  hook: hooks.hook,
};
