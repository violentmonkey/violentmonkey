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
    ok = ok || mat.length && function (urlParts) {
      return mat.some(function (str) {
        return matchTest(str, urlParts);
      });
    }(url.match(match_reg));
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

  exports.testURL = testURL;
});
