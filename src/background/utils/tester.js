import * as tld from '#/common/tld';
import cache from './cache';
import { postInitialize } from './init';
import { commands } from './message';
import { getOption, hookOptions } from './options';

Object.assign(commands, {
  TestBlacklist: testBlacklist,
});

postInitialize.push(resetBlacklist);

tld.initTLD(true);

const RE_MATCH_PARTS = /(.*?):\/\/([^/]*)\/(.*)/;
let blacklistRules = [];
hookOptions((changes) => {
  if ('blacklist' in changes) resetBlacklist(changes.blacklist || '');
});
const RE_HTTP_OR_HTTPS = /^https?$/i;

/*
 Simple FIFO queue for the results of testBlacklist, cached separately from the main |cache|
 because the blacklist is updated only once in a while so its entries would be crowding
 the main cache and reducing its performance (objects with lots of keys are slow to access).

 We also don't need to auto-expire the entries after a timeout.
 The only limit we're concerned with is the overall memory used.
 The limit is specified in the amount of unicode characters (string length) for simplicity.
 Disregarding deduplication due to interning, the actual memory used is approximately twice as big:
 2 * keyLength + objectStructureOverhead * objectCount
*/
const MAX_BL_CACHE_LENGTH = 100e3;
let blCache = {};
let blCacheSize = 0;

function testRules(url, rules, prefix, ruleBuilder) {
  return rules.some(rule => {
    const key = `${prefix}:${rule}`;
    let matcher = cache.get(key);
    if (matcher) cache.hit(key);
    else cache.put(key, (matcher = ruleBuilder(rule)));
    return matcher.test(url);
  });
}

/**
 * Test glob rules like `@include` and `@exclude`.
 */
export function testGlob(url, rules) {
  return testRules(url, rules, 're', autoReg);
}

/**
 * Test match rules like `@match` and `@exclude_match`.
 */
export function testMatch(url, rules) {
  return testRules(url, rules, 'match', matchTester);
}

export function testScript(url, script) {
  cache.batch(true);
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
  cache.batch(false);
  return ok;
}

function mergeLists(...args) {
  return args.reduce((res, item) => (item ? res.concat(item) : res), []);
}

function str2RE(str) {
  const re = str.replace(/([.?+[\]{}()|^$])/g, '\\$1').replace(/\*/g, '.*?');
  return re;
}

function bindRE(re) {
  return re.test.bind(re);
}

function autoReg(str) {
  // regexp mode: case-insensitive per GM documentation
  if (str.length > 1 && str[0] === '/' && str[str.length - 1] === '/') {
    let re;
    try { re = new RegExp(str.slice(1, -1), 'i'); } catch (e) { /* ignore */ }
    return { test: re ? bindRE(re) : () => false };
  }
  // glob mode: case-insensitive to match GM4 & Tampermonkey bugged behavior
  const reStr = str2RE(str.toLowerCase());
  if (tld.isReady() && str.includes('.tld/')) {
    const reTldStr = reStr.replace('\\.tld/', '((?:\\.[-\\w]+)+)/');
    return {
      test: (tstr) => {
        const matches = tstr.toLowerCase().match(reTldStr);
        if (matches) {
          const suffix = matches[1].slice(1);
          if (tld.getPublicSuffix(suffix) === suffix) return true;
        }
        return false;
      },
    };
  }
  const re = new RegExp(`^${reStr}$`, 'i'); // String with wildcards
  return { test: bindRE(re) };
}

function matchScheme(rule, data) {
  // exact match
  if (rule === data) return 1;
  // * = http | https
  // support http*
  if ([
    '*',
    'http*',
  ].includes(rule) && RE_HTTP_OR_HTTPS.test(data)) return 1;
  return 0;
}

const RE_STR_ANY = '(?:|.*?\\.)';
const RE_STR_TLD = '((?:\\.[-\\w]+)+)';
function hostMatcher(rule) {
  // * matches all
  if (rule === '*') {
    return () => 1;
  }
  // *.example.com
  // www.google.*
  // www.google.tld
  const ruleLC = rule.toLowerCase(); // host matching is case-insensitive
  let prefix = '';
  let base = ruleLC;
  let suffix = '';
  if (rule.startsWith('*.')) {
    base = base.slice(2);
    prefix = RE_STR_ANY;
  }
  if (tld.isReady() && rule.endsWith('.tld')) {
    base = base.slice(0, -4);
    suffix = RE_STR_TLD;
  }
  const re = new RegExp(`^${prefix}${str2RE(base)}${suffix}$`);
  return (data) => {
    // exact match, case-insensitive
    data = data.toLowerCase();
    if (ruleLC === data) return 1;
    // full check
    const matches = data.match(re);
    if (matches) {
      const [, tldStr] = matches;
      if (!tldStr) return 1;
      const tldSuffix = tldStr.slice(1);
      return tld.getPublicSuffix(tldSuffix) === tldSuffix;
    }
    return 0;
  };
}

function pathMatcher(rule) {
  const iHash = rule.indexOf('#');
  let iQuery = rule.indexOf('?');
  let strRe = str2RE(rule);
  if (iQuery > iHash) iQuery = -1;
  if (iHash < 0) {
    if (iQuery < 0) strRe = `^${strRe}(?:[?#]|$)`;
    else strRe = `^${strRe}(?:#|$)`;
  }
  return bindRE(new RegExp(strRe));
}

function matchTester(rule) {
  let test;
  if (rule === '<all_urls>') {
    test = () => true;
  } else {
    const ruleParts = rule.match(RE_MATCH_PARTS);
    if (ruleParts) {
      const matchHost = hostMatcher(ruleParts[2]);
      const matchPath = pathMatcher(ruleParts[3]);
      test = (url) => {
        const parts = url.match(RE_MATCH_PARTS);
        return !!ruleParts && !!parts
          && matchScheme(ruleParts[1], parts[1])
          && matchHost(parts[2])
          && matchPath(parts[3]);
      };
    } else {
      // Ignore invalid match rules
      test = () => false;
    }
  }
  return { test };
}

export function testBlacklist(url) {
  let res = blCache[url];
  if (res === undefined) {
    const rule = blacklistRules.find(({ test }) => test(url));
    res = rule?.reject && rule.text;
    updateBlacklistCache(url, res || false);
  }
  return res;
}

export function resetBlacklist(list) {
  cache.batch(true);
  const rules = list == null ? getOption('blacklist') : list;
  if (process.env.DEBUG) {
    console.info('Reset blacklist:', rules);
  }
  // XXX compatible with {Array} list in v2.6.1-
  blacklistRules = (Array.isArray(rules) ? rules : (rules || '').split('\n'))
  .map((text) => {
    text = text.trim();
    if (!text || text.startsWith('#')) return null;
    const mode = text.startsWith('@') && text.split(/\s/, 1)[0];
    const rule = mode ? text.slice(mode.length + 1).trim() : text;
    const reject = mode !== '@include' && mode !== '@match'; // @include and @match = whitelist
    const { test } = mode === '@include' || mode === '@exclude' && autoReg(rule)
      || !mode && !rule.includes('/') && matchTester(`*://${rule}/*`) // domain
      || matchTester(rule); // @match and @exclude-match
    return { reject, test, text };
  })
  .filter(Boolean);
  blCache = {};
  blCacheSize = 0;
  cache.batch(false);
}

function updateBlacklistCache(key, value) {
  blCache[key] = value;
  blCacheSize += key.length;
  if (blCacheSize > MAX_BL_CACHE_LENGTH) {
    Object.keys(blCache)
    .some((k) => {
      blCacheSize -= k.length;
      delete blCache[k];
      // reduce the cache to 75% so that this function doesn't run too often.
      return blCacheSize < MAX_BL_CACHE_LENGTH * 3 / 4;
    });
  }
}
