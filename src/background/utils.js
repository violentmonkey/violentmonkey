var scriptUtils = {
  isRemote: function (url) {
    return url && !/^(file|data):/.test(url);
  },
  fetch: function (url, type, headers) {
    var xhr = new XMLHttpRequest;
    xhr.open('GET', url, true);
    if (type) xhr.responseType = type;
    if (headers) for (var k in headers)
      xhr.setRequestHeader(k, headers[k]);
    return new Promise(function (resolve, reject) {
      xhr.onload = function () {
        resolve(this);
      };
      xhr.onerror = function () {
        reject(this);
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
    code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, function(value, group1, group2) {
      if (flag < 0 && group1 == '==UserScript==')
        // start meta
        flag = 1;
      else if(flag > 0 && group1 == '==/UserScript==')
        // end meta
        flag = 0;
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
    meta.resource.forEach(function(line) {
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
      code: '// ==UserScript==\n// @name New Script\n// ==/UserScript==\n',
    };
    script.meta = scriptUtils.parseMeta(script.code);
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

var tester = function () {
  function testURL(url, script) {
    var custom = script.custom;
    var meta = script.meta;
    var inc = [], exc = [], mat = [];
    var ok = true;
    if (custom._match !== false && meta.match) mat = mat.concat(meta.match);
    if (custom.match) mat = mat.concat(custom.match);
    if (custom._include !== false && meta.include) inc = inc.concat(meta.include);
    if (custom.include) inc = inc.concat(custom.include);
    if (custom._exclude !== false && meta.exclude) exc = exc.concat(meta.exclude);
    if (custom.exclude) exc = exc.concat(custom.exclude);
    if (mat.length) {
      // @match
      var urlParts = url.match(match_reg);
      ok = mat.some(function (str) {
        return matchTest(str, urlParts);
      });
    } else {
      // @include
      ok = inc.some(function (str) {
        return autoReg(str).test(url);
      });
    }
    // exclude
    ok = ok && !exc.some(function (str) {
      return autoReg(str).test(url);
    });
    return ok;
  }

  function str2RE(str) {
    return RegExp('^' + str.replace(/([.?\/])/g, '\\$1').replace(/\*/g, '.*?') + '$');
  }

  function autoReg(str) {
    if (/^\/.*\/$/.test(str))
      return RegExp(str.slice(1, -1));  // Regular-expression
    else
      return str2RE(str); // String with wildcards
  }

  var match_reg = /(.*?):\/\/([^\/]*)\/(.*)/;
  function matchTest(str, urlParts) {
    if (str == '<all_urls>') return true;
    var parts = str.match(match_reg);
    var ok = !!parts;
    // scheme
    ok = ok && (
      // exact match
      parts[1] == urlParts[1]
      // * = http | https
      || parts[1] == '*' && /^https?$/i.test(urlParts[1])
    );
    // host
    ok = ok && (
      // * matches all
      parts[2] == '*'
      // exact match
      || parts[2] == urlParts[2]
      // *.example.com
      || /^\*\.[^*]*$/.test(parts[2]) && str2RE(parts[2]).test(urlParts[2])
    );
    // pathname
    ok = ok && str2RE(parts[3]).test(urlParts[3]);
    return ok;
  }

  return {
    testURL: testURL,
  };
}();
