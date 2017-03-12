var options = require('../options');

function testScript(url, script) {
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
  ok = ok || testMatches(url, mat);
  // @include
  ok = ok || testRules(url, inc);
  // @exclude
  ok = ok && !testRules(url, exc);
  return ok;
}

function testRules(url, rules) {
  return rules.some(function (rule) {
    return autoReg(rule).test(url);
  });
}
function testMatches(url, rules) {
  if (rules.length) {
    var test = matchTester(url);
    return rules.some(test);
  }
  return false;
}

function str2RE(str) {
  return RegExp('^' + str.replace(/([.?\/])/g, '\\$1').replace(/\*/g, '.*?') + '$');
}

function autoReg(str) {
  return str.length > 1 && str.charAt(0) === '/' && str.charAt(str.length - 1) === '/'
    ? RegExp(str.slice(1, -1))  // Regular-expression
    : str2RE(str);              // String with wildcards
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

var testBlacklist = function () {
  function testBlacklist(url) {
    return blacklistRE.some(function (re) {
      return re.test(url);
    });
  }
  function reset(list) {
    blacklistRE = (list || []).map(function (rule) {
      return autoReg(rule);
    });
  }
  var blacklistRE = [];
  reset(options.get('blacklist'));
  options.hook(function (changes) {
    var blacklist = changes.blacklist;
    blacklist && reset(blacklist);
  });
  return testBlacklist;
}();

exports.testScript = testScript;
exports.testBlacklist = testBlacklist;
