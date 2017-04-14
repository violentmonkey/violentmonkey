import cache from './cache';
import { getOption, hookOptions } from './options';

/**
 * Test glob rules like `@include` and `@exclude`.
 */
export function testGlob(url, rules) {
  const lifetime = 60 * 1000;
  return rules.some(rule => {
    const key = `re:${rule}`;
    let re = cache.get(key);
    if (re) {
      cache.hit(key, lifetime);
    } else {
      re = autoReg(rule);
      cache.put(key, re, lifetime);
    }
    return re.test(url);
  });
}

/**
 * Test match rules like `@match` and `@exclude_match`.
 */
export function testMatch(url, rules) {
  const lifetime = 10 * 1000;
  const key = `match:${url}`;
  let matcher = cache.get(key);
  if (matcher) {
    cache.hit(key, lifetime);
  } else {
    matcher = matchTester(url);
    cache.put(key, matcher, lifetime);
  }
  return rules.some(matcher);
}

export function testScript(url, script) {
  const { custom, meta } = script;
  const mat = mergeLists(custom._match !== false && meta.match, custom.match);
  const inc = mergeLists(custom._include !== false && meta.include, custom.include);
  const exc = mergeLists(custom._exclude !== false && meta.exclude, custom.exclude);
  const excMat = mergeLists(
    custom._excludeMatch !== false && meta.excludeMatch,
    custom.excludeMatch,
  );
  // match all if no @match or @include rule
  let ok = !mat.length && !inc.length;
  // @match
  ok = ok || testMatch(url, mat);
  // @include
  ok = ok || testGlob(url, inc);
  // @exclude-match
  ok = ok && !testMatch(url, excMat);
  // @exclude
  ok = ok && !testGlob(url, exc);
  return ok;
}

function mergeLists(...args) {
  return args.reduce((res, item) => (item ? res.concat(item) : res), []);
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
function matchTester(url) {
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
