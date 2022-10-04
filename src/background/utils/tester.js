import { getScriptPrettyUrl } from '@/common';
import { BLACKLIST, BLACKLIST_ERRORS } from '@/common/consts';
import initCache from '@/common/cache';
import * as tld from '@/common/tld';
import { postInitialize } from './init';
import { commands } from './message';
import { getOption, hookOptions } from './options';
import storage from './storage';

Object.assign(commands, {
  TestBlacklist: testBlacklist,
});

const matchAlways = () => 1;
/**
 * Using separate caches to avoid memory consumption for thousands of prefixed long urls
 * TODO: switch `cache` to hubs internally and add a prefix parameter or accept an Array for key
 */
const cacheMat = initCache({ lifetime: 60 * 60e3 });
const cacheInc = initCache({ lifetime: 60 * 60e3 });
const cacheResultMat = initCache({ lifetime: 60e3 });
const cacheResultInc = initCache({ lifetime: 60e3 });
const RE_MATCH_PARTS = /(.*?):\/\/([^/]*)\/(.*)/;
const RE_HTTP_OR_HTTPS = /^https?$/i;
const MAX_BL_CACHE_LENGTH = 100e3;
let blCache = {};
let blCacheSize = 0;
let blacklistRules = [];
let batchErrors;

postInitialize.push(resetBlacklist);
hookOptions((changes) => {
  if (BLACKLIST in changes) {
    const errors = resetBlacklist(changes[BLACKLIST] || []);
    const res = errors.length ? errors : null;
    storage.base.setOne(BLACKLIST_ERRORS, res);
    if (res) throw res; // will be passed to the UI
  }
});
tld.initTLD(true);

export function testerBatch(arr) {
  cacheMat.batch(arr);
  cacheInc.batch(arr);
  cacheResultMat.batch(arr);
  cacheResultInc.batch(arr);
  batchErrors = Array.isArray(arr) && arr;
}

/**
 * As this code is *very* hot, we avoid calling functions or creating possibly big arrays
 * or creating copies of thousands of keys by prefixing them in `cache`, thus we avoid pauses
 * due to major GC. The speedup is ~3x (from ~40ms to ~14ms) on a 4GHz CPU
 * with popular scripts that have lots of @match e.g. Handy Image.
 */
export function testScript(url, script) {
  let matex1; // main @match / @exclude-match
  let matex2; // custom @match / @exclude-match
  let inex1; // main @include / @exclude
  let inex2; // custom @include / @exclude
  const { custom, meta } = script;
  const len = (matex1 = custom.origMatch && meta.match || '').length
    + (matex2 = custom.match || '').length
    + (inex1 = custom.origInclude && meta.include || '').length
    + (inex2 = custom.include || '').length;
  const ok = (
    // Ok if lists are empty or @match + @include apply
    !len || testRules(url, script, matex1, matex2, inex1, inex2)
  ) && !(
    // and no excludes apply
    ((matex1 = custom.origExcludeMatch && meta.excludeMatch || '').length
      + (matex2 = custom.excludeMatch || '').length
      + (inex1 = custom.origExclude && meta.exclude || '').length
      + (inex2 = custom.exclude || '').length
    ) && testRules(url, script, matex1, matex2, inex1, inex2)
  );
  return ok;
}

function testRules(url, script, ...list) {
  // TODO: combine all non-regex rules in one big smart regexp
  // e.g. lots of `*://foo/*` can be combined into `^https?://(foo|bar|baz)/`
  for (let i = 0, m, rules, builder, cache, urlResults, res, err, scriptUrl; i < 4; i += 1) {
    // [matches, matches, includes, includes], some items may be empty
    if ((rules = list[i]).length) {
      if (!cache) { // happens one time for 0 or 1 and another time for 2 or 3
        if (i < 2) { // matches1, matches2
          builder = matchTester;
          cache = cacheMat;
          urlResults = cacheResultMat;
        } else { // includes1, includes2
          builder = autoReg;
          cache = cacheInc;
          urlResults = cacheResultInc;
        }
        urlResults = urlResults.get(url) || urlResults.put(url, {});
      }
      for (const rule of rules) {
        if ((res = urlResults[rule]) != null) {
          return res;
        }
        if (!(m = cache.get(rule))) {
          try {
            m = builder(rule);
          } catch (e) {
            m = { err: e };
          }
          cache.put(rule, m);
        }
        if ((err = m.err)) {
          if (batchErrors) {
            err = err.message || err;
            err = url
              ? `${err} - ${scriptUrl || (scriptUrl = getScriptPrettyUrl(script))}`
              : err;
            batchErrors.push(err);
          }
        } else if ((urlResults[rule] = m.test(url))) {
          return true;
        }
      }
    }
    if (i === 1) cache = false; // this will switch cache+builder for includes if they're non-empty
  }
}

function str2RE(str) {
  const re = str.replace(/([.?+[\]{}()|^$])/g, '\\$1').replace(/\*/g, '.*?');
  return re;
}

function autoReg(str) {
  // regexp mode: case-insensitive per GM documentation
  if (str.length > 1 && str[0] === '/' && str[str.length - 1] === '/') {
    return new RegExp(str.slice(1, -1), 'i');
  }
  // glob mode: case-insensitive to match GM4 & Tampermonkey bugged behavior
  const reStr = str2RE(str.toLowerCase());
  const reTldStr = reStr.replace('\\.tld/', '((?:\\.[-\\w]+)+)/');
  if (reStr !== reTldStr) {
    return { test: matchTld.bind([reTldStr]) };
  }
  // String with wildcards
  return RegExp(`^${reStr}$`, 'i');
}

function matchTld(tstr) {
  const matches = tstr.toLowerCase().match(this[0]);
  const suffix = matches?.[1].slice(1);
  return suffix && tld.getPublicSuffix(suffix) === suffix;
}

function matchScheme(rule, data) {
  // exact match
  if (rule === data) return 1;
  // * = http | https
  // support http*
  if ((rule === '*' || rule === 'http*') && RE_HTTP_OR_HTTPS.test(data)) return 1;
  return 0;
}

const RE_STR_ANY = '(?:|.*?\\.)';
const RE_STR_TLD = '((?:\\.[-\\w]+)+)';
function hostMatcher(rule) {
  // * matches all
  if (rule === '*') {
    return matchAlways;
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
  return hostMatcherFunc.bind([ruleLC, re]);
}

function hostMatcherFunc(data) {
  // exact match, case-insensitive
  data = data.toLowerCase();
  if (this[0] === data) return 1;
  // full check
  const matches = data.match(this[1]);
  if (matches) {
    const [, tldStr] = matches;
    if (!tldStr) return 1;
    const tldSuffix = tldStr.slice(1);
    return tld.getPublicSuffix(tldSuffix) === tldSuffix;
  }
  return 0;
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
  return RegExp(strRe);
}

function matchTester(rule) {
  let test;
  if (rule === '<all_urls>') {
    test = matchAlways;
  } else {
    const ruleParts = rule.match(RE_MATCH_PARTS);
    if (ruleParts) {
      test = matchTesterFunc.bind([
        ruleParts[1],
        hostMatcher(ruleParts[2]),
        pathMatcher(ruleParts[3]),
      ]);
    } else {
      throw `Invalid @match ${rule}`;
    }
  }
  return { test };
}

function matchTesterFunc(url) {
  const parts = url.match(RE_MATCH_PARTS);
  return +!!(parts
    && matchScheme(this[0], parts[1])
    && this[1](parts[2])
    && this[2].test(parts[3])
  );
}

export function testBlacklist(url) {
  let res = blCache[url];
  if (res === undefined) {
    const rule = blacklistRules.find(m => m.test(url));
    res = rule?.reject && rule.text;
    updateBlacklistCache(url, res || false);
  }
  return res;
}

export function resetBlacklist(rules = getOption(BLACKLIST)) {
  const emplace = (cache, rule, builder) => cache.get(rule) || cache.put(rule, builder(rule));
  const errors = [];
  testerBatch(true);
  if (process.env.DEBUG) {
    console.info('Reset blacklist:', rules);
  }
  // XXX compatible with {Array} list in v2.6.1-
  blacklistRules = (Array.isArray(rules) ? rules : (rules || '').split('\n'))
  .reduce((res, text) => {
    try {
      text = text.trim();
      if (!text || text.startsWith('#')) return res;
      const mode = text.startsWith('@') && text.split(/\s/, 1)[0];
      const rule = mode ? text.slice(mode.length + 1).trim() : text;
      const isInc = mode === '@include';
      const m = (isInc || mode === '@exclude') && emplace(cacheInc, rule, autoReg)
      || !mode && !rule.includes('/') && emplace(cacheMat, `*://${rule}/*`, matchTester) // domain
      || emplace(cacheMat, rule, matchTester); // @match and @exclude-match
      m.reject = !(mode === '@match' || isInc); // @include and @match = whitelist
      m.text = text;
      res.push(m);
    } catch (err) {
      errors.push(err);
    }
    return res;
  }, []);
  blCache = {};
  blCacheSize = 0;
  testerBatch();
  return errors;
}

/**
 Simple FIFO queue for the results of testBlacklist, cached separately from the main |cache|
 because the blacklist is updated only once in a while so its entries would be crowding
 the main cache and reducing its performance (objects with lots of keys are slow to access).
 We also don't need to auto-expire the entries after a timeout.
 The only limit we're concerned with is the overall memory used.
 The limit is specified in the amount of unicode characters (string length) for simplicity.
 Disregarding deduplication due to interning, the actual memory used is approximately twice as big:
 2 * keyLength + objectStructureOverhead * objectCount
*/
function updateBlacklistCache(key, value) {
  blCache[key] = value;
  blCacheSize += key.length;
  if (blCacheSize > MAX_BL_CACHE_LENGTH) {
    for (const k in blCache) {
      if (delete blCache[k] && (blCacheSize -= k.length) < MAX_BL_CACHE_LENGTH * 0.75) {
        // Reduced the cache to 75% so that this function doesn't run too often
        return;
      }
    }
  }
}
