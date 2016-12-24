// Polyfill start

function polyfill(obj, name, value) {
  if (!obj[name]) Object.defineProperty(obj, name, {
    value: value,
  });
}

polyfill(Object, 'assign', function () {
  var obj = arguments[0];
  for (var i = 1; i < arguments.length; i ++) {
    var arg = arguments[i];
    arg && Object.keys(arg).forEach(function (key) {
      obj[key] = arg[key];
    });
  }
  return obj;
});
polyfill(String.prototype, 'startsWith', function (str) {
  return this.slice(0, str.length) === str;
});
polyfill(String.prototype, 'endsWith', function (str) {
  return this.slice(-str.length) === str;
});
polyfill(Array.prototype, 'findIndex', function (predicate) {
  var length = this.length;
  for (var i = 0; i < length; i ++) {
    var item = this[i];
    if (predicate(item, i, this)) return i;
  }
  return -1;
});
polyfill(Array.prototype, 'find', function (predicate) {
  return this[this.findIndex(predicate)];
});

// Polyfill end

var _ = exports;
_.i18n = chrome.i18n.getMessage;
_.defaultImage = '/images/icon128.png';

function normalizeKeys(key) {
  if (!key) key = [];
  if (!Array.isArray(key)) key = key.toString().split('.');
  return key;
}

_.normalizeKeys = normalizeKeys;

_.object = function () {
  function get(obj, key, def) {
    var keys = normalizeKeys(key);
    for (var i = 0, len = keys.length; i < len; i ++) {
      key = keys[i];
      if (obj && (key in obj)) obj = obj[key];
      else return def;
    }
    return obj;
  }
  function set(obj, key, val) {
    var keys = normalizeKeys(key);
    if (!keys.length) return val;
    var sub = obj = obj || {};
    for (var i = 0, len = keys.length - 1; i < len; i ++) {
      key = keys[i];
      sub = sub[key] = sub[key] || {};
    }
    sub[keys[keys.length - 1]] = val;
    return obj;
  }
  return {
    get: get,
    set: set,
  };
}();

_.options = function () {
  function getOption(key, def) {
    var keys = normalizeKeys(key);
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

  function fire(hkey, key, value) {
    var group = hooks[hkey];
    group && group.forEach(function (cb) {
      cb(value, key);
    });
  }

  function setOption(key, value) {
    var keys = normalizeKeys(key);
    var optionKey = keys.join('.');
    var optionValue = value;
    key = keys[0];
    if (key in defaults) {
      if (keys.length > 1) {
        optionValue = _.object.set(getOption(key), keys.slice(1), value);
      }
      localStorage.setItem(key, JSON.stringify(optionValue));
      [optionKey, key, ''].forEach(function (hkey) {
        fire(hkey, optionKey, value);
      });
    }
  }

  function getAllOptions() {
    return Object.keys(defaults).reduce(function (res, key) {
      res[key] = getOption(key);
      return res;
    }, {});
  }

  function parseArgs(args) {
    return args.length === 1 ? {
      key: '',
      cb: args[0],
    } : {
      key: args[0] || '',
      cb: args[1],
    };
  }

  function hook() {
    var arg = parseArgs(arguments);
    var list = hooks[arg.key];
    if (!list) list = hooks[arg.key] = [];
    list.push(arg.cb);
    return function () {
      unhook(arg.key, arg.cb);
    };
  }
  function unhook() {
    var arg = parseArgs(arguments);
    var list = hooks[arg.key];
    if (list) {
      var i = list.indexOf(arg.cb);
      ~i && list.splice(i, 1);
    }
  }

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
    dropbox: {},
    onedrive: {},
    features: null,
  };
  var hooks = {};

  // XXX migrate sync status options
  ['dropbox', 'onedrive'].forEach(function (name) {
    var key = name + 'Enabled';
    var val = getOption(key);
    if (val != null) {
      setOption([name, 'enabled'], val);
      localStorage.removeItem(key);
    }
  });

  return {
    get: getOption,
    set: setOption,
    getAll: getAllOptions,
    hook: hook,
    unhook: unhook,
  };
}();

_.sendMessage = function (data) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage(data, function (res) {
      res && res.error ? reject(res.error) : resolve(res && res.data);
    });
  });
};

_.debounce = function (func, time) {
  function run(thisObj, args) {
    timer = null;
    func.apply(thisObj, args);
  }
  var timer;
  return function (args) {
    timer && clearTimeout(timer);
    timer = setTimeout(run, time, this, args);
  };
};

_.noop = function () {};

_.zfill = function (num, length) {
  num = num.toString();
  while (num.length < length) num = '0' + num;
  return num;
};

_.getUniqId = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
};

/**
 * Get locale attributes such as `@name:zh-CN`
 */
_.getLocaleString = function (meta, key) {
  var lang = navigator.languages.find(function (lang) {
    return (key + ':' + lang) in meta;
  });
  if (lang) key += ':' + lang;
  return meta[key] || '';
};
