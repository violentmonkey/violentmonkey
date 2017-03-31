import { getOption, hookOptions } from './options';

export function testScript(url, script) {
  const { custom, meta } = script;
  let inc = [];
  let exc = [];
  let mat = [];
  if (custom._match !== false && meta.match) mat = mat.concat(meta.match);
  if (custom.match) mat = mat.concat(custom.match);
  if (custom._include !== false && meta.include) inc = inc.concat(meta.include);
  if (custom.include) inc = inc.concat(custom.include);
  if (custom._exclude !== false && meta.exclude) exc = exc.concat(meta.exclude);
  if (custom.exclude) exc = exc.concat(custom.exclude);
  let ok = !mat.length && !inc.length;
  // @match
  ok = ok || testMatches(url, mat);
  // @include
  ok = ok || testRules(url, inc);
  // @exclude
  ok = ok && !testRules(url, exc);
  return ok;
}

function testRules(url, rules) {
  return rules.some(rule => autoReg(rule).test(url));
}
function testMatches(url, rules) {
  return rules.length && rules.some(matchTester(url));
}

function str2RE(str) {
  const re = str.replace(/([.?/])/g, '\\$1').replace(/\*/g, '.*?');
  return RegExp(`^${re}$`);
}

function autoReg(str) {
  if (str.length > 1 && str[0] === '/' && str[str.length - 1] === '/') {
    return RegExp(str.slice(1, -1));  // Regular-expression
  }
  return str2RE(str);              // String with wildcards
}

function matchTester(url) {
  function matchScheme(rule, data) {
    // exact match
    if (rule === data) return 1;
    // * = http | https
    if (rule === '*' && /^https?$/i.test(data)) return 1;
    return 0;
  }
  function matchHost(rule, data) {
    // * matches all
    if (rule === '*') return 1;
    // exact match
    if (rule === data) return 1;
    // *.example.com
    if (/^\*\.[^*]*$/.test(rule)) {
      // matches the specified domain
      if (rule.slice(2) === data) return 1;
      // matches subdomains
      if (str2RE(rule).test(data)) return 1;
    }
    return 0;
  }
  function matchPath(rule, data) {
    return str2RE(rule).test(data);
  }
  const RE = /(.*?):\/\/([^/]*)\/(.*)/;
  const urlParts = url.match(RE);
  return str => {
    if (str === '<all_urls>') return true;
    const parts = str.match(RE);
    return !!parts
      && matchScheme(parts[1], urlParts[1])
      && matchHost(parts[2], urlParts[2])
      && matchPath(parts[3], urlParts[3]);
  };
}

let blacklistRE = [];
resetBlacklist(getOption('blacklist'));
hookOptions(changes => {
  const { blacklist } = changes;
  if (blacklist) resetBlacklist(blacklist);
});
export function testBlacklist(url) {
  return blacklistRE.some(re => re.test(url));
}
function resetBlacklist(list) {
  blacklistRE = (list || []).map(rule => autoReg(rule));
}
