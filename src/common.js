var _ = module.exports = {};
_.i18n = chrome.i18n.getMessage;

_.options = function () {
  function getOption(key, def) {
    var value = localStorage.getItem(key), obj;
    if (value)
      try {
        obj = JSON.parse(value);
      } catch (e) {
        obj = def;
      }
    else obj = def;
    if (obj == null) obj = defaults[key];
    return obj;
  }

  function setOption(key, value) {
    if (key in defaults) {
      localStorage.setItem(key, JSON.stringify(value));
      [hooks[key], hooks['']].forEach(function (group) {
        group && group.forEach(function (cb) {
          cb(value, key);
        });
      });
    }
  }

  function getAllOptions() {
    var options = {};
    for (var i in defaults) options[i] = getOption(i);
    return options;
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
    exportValues: true,
    closeAfterInstall: false,
    trackLocalFile: false,
    autoReload: false,
    dropbox: {},
    dropboxEnabled: false,
    onedrive: {},
    onedriveEnabled: false,
    features: null,
  };
  var hooks = {};

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
  function run() {
    cancel();
    func();
  }
  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  var timer;
  return function () {
    cancel();
    timer = setTimeout(run, time);
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
