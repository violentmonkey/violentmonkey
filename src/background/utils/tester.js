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
  const lifetime = 60 * 1000;
  return rules.some(rule => {
    const key = `match:${rule}`;
    let matcher = cache.get(key);
    if (matcher) {
      cache.hit(key, lifetime);
    } else {
      matcher = matchTester(rule);
      cache.put(key, matcher, lifetime);
    }
    return matcher.test(url);
  });
}

export function testScript(url, script) {
  const { custom, meta } = script;
  const mat = mergeLists(custom.origMatch && meta.match, custom.match);
  const inc = mergeLists(custom.origInclude && meta.include, custom.include);
  const exc = mergeLists(custom.origExclude && meta.exclude, custom.exclude);
  const excMat = mergeLists(custom.origExcludeMatch && meta.excludeMatch, custom.excludeMatch);
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
function matchTester(rule) {
  let test;
  if (rule === '<all_urls>') test = () => true;
  else {
    const RE = /(.*?):\/\/([^/]*)\/(.*)/;
    const ruleParts = rule.match(RE);
    test = url => {
      const parts = url.match(RE);
      return !!ruleParts && !!parts
      && matchScheme(ruleParts[1], parts[1])
      && matchHost(ruleParts[2], parts[2])
      && matchPath(ruleParts[3], parts[3]);
    };
  }
  return { test };
}

let blacklistRules = [];
resetBlacklist(getOption('blacklist'));
hookOptions(changes => {
  const { blacklist } = changes;
  if (blacklist) resetBlacklist(blacklist);
});
export function testBlacklist(url) {
  return blacklistRules.some(re => re.test(url));
}
export function resetBlacklist(list) {
  // XXX compatible with {Array} list in v2.6.1-
  blacklistRules = (Array.isArray(list) ? list : (list || '').split('\n'))
  .map(line => {
    const item = line.trim();
    if (!item || item.startsWith('#')) return;
    // @exclude
    if (item.startsWith('@exclude ')) return autoReg(item.slice(9).trim());
    // domains
    if (item.indexOf('/') < 0) return matchTester(`*://${item}/*`);
    // @exclude-match
    return matchTester(item);
  })
  .filter(Boolean);
}
