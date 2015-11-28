'use strict';

var _ = window._ || {};
_.i18n = chrome.i18n.getMessage;

_.options = function () {
  var defaults = {
    isApplied: true,
    autoUpdate: true,
    ignoreGrant: false,
    lastUpdate: 0,
    exportValues: true,
    closeAfterInstall: false,
    trackLocalFile: false,
    injectMode: 0,
    autoReload: false,
  };

  function getOption(key, def) {
    var value = localStorage.getItem(key), obj;
    if (value)
      try {
        obj = JSON.parse(value);
      } catch(e) {
        obj = def;
      }
      else obj = def;
      if (obj == null) obj = defaults[key];
      return obj;
  }

  function setOption(key, value) {
    if (key in defaults)
      localStorage.setItem(key, JSON.stringify(value));
  }

  function getAllOptions() {
    var options = {};
    for (var i in defaults) options[i] = getOption(i);
    return options;
  }

  return {
    get: getOption,
    set: setOption,
    getAll: getAllOptions,
  };
}();

_.sendMessage = function (data) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage(data, function (res) {
      res && res.error ? reject(res.error) : resolve(res && res.data);
    });
  });
};

_.updateCheckbox = function (e) {
  var target = e.target;
  _.options.set(target.dataset.check, target.checked);
};

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

/*
function format() {
  var args = arguments;
  if (args[0]) return args[0].replace(/\$(?:\{(\d+)\}|(\d+))/g, function(value, group1, group2) {
		var index = typeof group1 != 'undefined' ? group1 : group2;
		return index >= args.length ? value : (args[index] || '');
  });
}
*/
