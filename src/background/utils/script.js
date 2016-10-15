module.exports = {
  isRemote: function (url) {
    return url && !(/^(file|data):/.test(url));
  },
  fetch: function (url, type, headers) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest;
      xhr.open('GET', url, true);
      if (type) xhr.responseType = type;
      headers && Object.keys(headers).forEach(function (key) {
        xhr.setRequestHeader(key, headers[key]);
      });
      xhr.onloadend = function () {
        (xhr.status > 300 ? reject : resolve)(xhr);
      };
      xhr.send();
    });
  },
  parseMeta: function (code) {
    // initialize meta, specify those with multiple values allowed
    var meta = {
      include: [],
      exclude: [],
      match: [],
      require: [],
      resource: [],
      grant: [],
    };
    var flag = -1;
    code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, function (_match, group1, group2) {
      if (flag < 0 && group1 == '==UserScript==') {
        // start meta
        flag = 1;
      } else if (flag > 0 && group1 == '==/UserScript==') {
        // end meta
        flag = 0;
      }
      if (flag == 1 && group1[0] == '@') {
        var key = group1.slice(1);
        var val = group2.replace(/^\s+|\s+$/g, '');
        var value = meta[key];
        // multiple values allowed
        if (value && value.push) value.push(val);
        // only first value will be stored
        else if (!(key in meta)) meta[key] = val;
      }
    });
    meta.resources = {};
    meta.resource.forEach(function (line) {
      var pair = line.match(/^(\w\S*)\s+(.*)/);
      if (pair) meta.resources[pair[1]] = pair[2];
    });
    delete meta.resource;
    // @homepageURL: compatible with @homepage
    if (!meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
    return meta;
  },
  newScript: function () {
    var script = {
      custom: {},
      enabled: 1,
      update: 1,
      code: '// ==UserScript==\n// @name New Script\n// @namespace Violentmonkey Scripts\n// @grant none\n// ==/UserScript==\n',
    };
    script.meta = module.exports.parseMeta(script.code);
    return script;
  },
  getScriptInfo: function (script) {
    return {
      id: script.id,
      custom: script.custom,
      meta: script.meta,
      enabled: script.enabled,
      update: script.update,
    };
  },
  getNameURI: function (script) {
    var ns = script.meta.namespace || '';
    var name = script.meta.name || '';
    var nameURI = escape(ns) + ':' + escape(name) + ':';
    if (!ns && !name) nameURI += script.id || '';
    return nameURI;
  },
  compareVersion: function (ver1, ver2) {
    ver1 = (ver1 || '').split('.');
    ver2 = (ver2 || '').split('.');
    var len1 = ver1.length, len2 = ver2.length;
    for (var i = 0; i < len1 || i < len2; i ++) {
      var delta = (parseInt(ver1[i], 10) || 0) - (parseInt(ver2[i], 10) || 0);
      if (delta) return delta < 0 ? -1 : 1;
    }
    return 0;
  },
};
