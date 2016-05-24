define('utils/tester', function (_require, exports, _module) {
  function testURL(url, script) {
    var custom = script.custom;
    var meta = script.meta;
    var inc = [], exc = [], mat = [];
    if (custom._match !== false && meta.match) mat = mat.concat(meta.match);
    if (custom.match) mat = mat.concat(custom.match);
    if (custom._include !== false && meta.include) inc = inc.concat(meta.include);
    if (custom.include) inc = inc.concat(custom.include);
    if (custom._exclude !== false && meta.exclude) exc = exc.concat(meta.exclude);
    if (custom.exclude) exc = exc.concat(custom.exclude);
    var ok = !mat.length && !inc.length;
    // @match
    ok = ok || mat.length && function (test) {
      return mat.some(test);
    }(matchTester(url));
    // @include
    ok = ok || inc.some(function (str) {
      return autoReg(str).test(url);
    });
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

  function matchTester(url) {
    function matchScheme(rule, data) {
      // exact match
      if (rule == data) return 1;
      // * = http | https
      if (rule == '*' && /^https?$/i.test(data)) return 1;
      return 0;
    }
    function matchHost(rule, data) {
      // * matches all
      if (rule == '*') return 1;
      // exact match
      if (rule == data) return 1;
      // *.example.com
      if (/^\*\.[^*]*$/.test(rule)) {
        // matches the specified domain
        if (rule.slice(2) == data) return 1;
        // matches subdomains
        if (str2RE(rule).test(data)) return 1;
      }
      return 0;
    }
    function matchPath(rule, data) {
      return str2RE(rule).test(data);
    }
    var RE = /(.*?):\/\/([^\/]*)\/(.*)/;
    var urlParts = url.match(RE);
    return function (str) {
      if (str == '<all_urls>') return true;
      var parts = str.match(RE);
      return !!parts
        && matchScheme(parts[1], urlParts[1])
        && matchHost(parts[2], urlParts[2])
        && matchPath(parts[3], urlParts[3]);
    };
  }

  exports.testURL = testURL;
});
