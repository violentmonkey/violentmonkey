/* eslint-disable max-classes-per-file */
import { escapeStringForRegExp, getScriptPrettyUrl } from '@/common';
import { ERR_BAD_PATTERN, BLACKLIST, BLACKLIST_NET, ERRORS } from '@/common/consts';
import initCache from '@/common/cache';
import { getPublicSuffix } from '@/common/tld';
import { hookOptionsInit } from './options';
import storage from './storage';

const matchAlways = { test: () => 1 };
/**
 * Using separate caches to avoid memory consumption for thousands of prefixed long urls
 * TODO: switch `cache` to hubs internally and add a prefix parameter or accept an Array for key
 */
const cacheMat = initCache({ lifetime: 60 * 60e3 });
const cacheInc = initCache({ lifetime: 60 * 60e3 });
const cacheResultMat = initCache({ lifetime: 60e3 });
const cacheResultInc = initCache({ lifetime: 60e3 });
/** Simple matching for valid patterns */
const RE_MATCH_PARTS = re`/^
  (\*|http([s*])?|file|ftp|urn):\/\/
  ([^/]*)\/
  (.*)
/x`;
/** Resilient matching for broken patterns allows reporting errors with a helpful message */
const RE_MATCH_BAD = re`/^
  (
    \*|
    # allowing the incorrect http* scheme which is the same as *
    http([s*])?|
    file|
    ftp|
    urn|
    # detecting an unknown scheme
    ([^:]*?)(?=:)
  )
  # detecting a partially missing ://
  (:(?:\/(?:\/)?)?)?
  ([^/]*)
  # detecting a missing / for path
  (?:\/(.*))?
/x`;
/** Simpler matching for a valid URL */
const RE_URL_PARTS = /^([^:]*):\/\/([^/]*)\/(.*)/;
const RE_STR_ANY = '(?:|[^:/]*?\\.)';
const RE_STR_TLD = '(|(?:\\.[-\\w]+)+)';
const MAX_BL_CACHE_LENGTH = 100e3;
const blacklist = {
  [BLACKLIST]: CreateBlacklist(),
  [BLACKLIST_NET]: CreateBlacklist(),
};
export const {
  reset: resetBlacklist,
  test: testBlacklist,
} = blacklist[BLACKLIST];
export const testBlacklistNet = blacklist[BLACKLIST_NET].test;
// Context start
let batchErrors;
let curUrl;
let curScheme;
let curHost;
let curTail;
let urlResultsMat;
let urlResultsInc;
// Context end

hookOptionsInit((changes) => {
  for (const key in blacklist) {
    if (key in changes) {
      const errors = blacklist[key].reset(changes[key] || []);
      const res = errors.length ? errors : null;
      storage.base.setOne(key + ERRORS, res);
      if (res) throw res; // will be passed to the UI
    }
  }
});

export class MatchTest {
  constructor(rule, scheme, httpMod, host, path) {
    const isWild = scheme === '*' || httpMod === '*';
    this.scheme = isWild ? 'http' : scheme;
    this.scheme2 = isWild ? 'https' : null;
    this.host = host === '*' ? null : hostMatcher(host);
    this.path = path === '*' ? null : pathMatcher(path);
  }

  test() {
    return (this.scheme === curScheme || this.scheme2 === curScheme)
      && this.host?.test(curHost) !== false
      && this.path?.test(curTail) !== false;
  }

  /**
   * @returns {MatchTest|matchAlways}
   * @throws {string}
   */
  static try(rule) {
    let parts = rule.match(RE_MATCH_PARTS);
    if (parts) return new MatchTest(...parts);
    if (rule === '<all_urls>') return matchAlways; // checking it second as it's super rare
    // Report failed parts in detail
    parts = rule.match(RE_MATCH_BAD);
    parts = !parts ? '' : (
      (parts[3] != null ? `${parts[3] ? 'unknown' : 'missing'} scheme, ` : '')
      + (parts[4] !== '://' ? 'missing "://", ' : '')
      || (parts[6] == null ? 'missing "/" for path, ' : '')
    ).slice(0, -2) + ' in ';
    throw `${ERR_BAD_PATTERN} ${parts}${rule}`;
  }
}

/** For strings without wildcards/tld it's 1.5x faster and much more memory-efficient than RegExp */
class StringTest {
  constructor(str, i, ignoreCase) {
    this.s = ignoreCase ? str.toLowerCase() : str;
    this.i = !!ignoreCase; // must be boolean to ensure test() returns boolean
    this.cmp = i < 0 ? '' : (i && 'startsWith' || 'endsWith');
  }

  test(str) {
    const { s, cmp } = this;
    const delta = str.length - s.length;
    const res = delta >= 0 && (
      cmp && delta
        ? str[cmp](s) || this.i && str.toLowerCase()[cmp](s)
        : str === s || !delta && this.i && str.toLowerCase() === s
    );
    return res;
  }

  /** @returns {?StringTest} */
  static try(rule, ignoreCase) {
    // TODO: support *. for domain if it's faster than regex
    const i = rule.indexOf('*');
    if (i === rule.length - 1) {
      rule = rule.slice(0, -1); // prefix*
    } else if (i === 0 && rule.indexOf('*', 1) < 0) {
      rule = rule.slice(1); // *suffix
    } else if (i >= 0) {
      return; // *wildcards*anywhere*
    }
    return new StringTest(rule, i, ignoreCase);
  }
}


export function testerBatch(arr) {
  cacheMat.batch(arr);
  cacheInc.batch(arr);
  cacheResultMat.batch(arr);
  cacheResultInc.batch(arr);
  batchErrors = Array.isArray(arr) && arr;
}

function setContext(url) {
  curUrl = url;
  [, curScheme, curHost, curTail] = url
    ? url.match(RE_URL_PARTS)
    : ['', '', '', '']; // parseMetaWithErrors uses an empty url for tests
  urlResultsMat = url ? (cacheResultMat.get(url) || cacheResultMat.put(url, {})) : null;
  urlResultsInc = url ? (cacheResultInc.get(url) || cacheResultInc.put(url, {})) : null;
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
  if (curUrl !== url) setContext(url);
  // TODO: combine all non-regex rules in one big smart regexp
  // e.g. lots of `*://foo/*` can be combined into `^https?://(foo|bar|baz)/`
  for (let i = 0, m, rules, builder, cache, urlResults, res, err, scriptUrl; i < 4; i += 1) {
    // [matches, matches, includes, includes], some items may be empty
    if ((rules = list[i]).length) {
      if (!cache) { // happens one time for 0 or 1 and another time for 2 or 3
        if (i < 2) { // matches1, matches2
          builder = MatchTest.try;
          cache = cacheMat;
          urlResults = urlResultsMat;
        } else { // includes1, includes2
          builder = autoReg;
          cache = cacheInc;
          urlResults = urlResultsInc;
        }
      }
      for (const rule of rules) {
        if (url && (res = urlResults[rule])) {
          return res;
        }
        if (res == null) {
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
          } else if (url && (urlResults[rule] = +!!m.test(url))) {
            return true;
          }
        }
      }
    }
    if (i === 1) cache = false; // this will switch cache+builder for includes if they're non-empty
  }
}

function str2RE(str) {
  return escapeStringForRegExp(str).replace(/\*/g, '.*?');
}

function autoReg(str) {
  // regexp mode: case-insensitive per GM documentation
  if (str.length > 1 && str[0] === '/' && str[str.length - 1] === '/') {
    return new RegExp(str.slice(1, -1), 'i');
  }
  const isTld = str.includes('.tld/');
  const strTester = !isTld && StringTest.try(str, true);
  if (strTester) {
    return strTester;
  }
  // glob mode: case-insensitive to match GM4 & Tampermonkey bugged behavior
  const reStr = `^${str2RE(str)}$`;
  const reTldStr = isTld ? reStr.replace('\\.tld/', '((?:\\.[-\\w]+)+)/') : reStr;
  const re = RegExp(reTldStr, 'i');
  if (reStr !== reTldStr) re.test = matchTld;
  return re;
}

function matchTld(tstr) {
  const matches = tstr.match(this);
  const suffix = matches?.[1]?.slice(1).toLowerCase();
  // Must return a proper boolean
  return !!suffix && getPublicSuffix(suffix) === suffix;
}

function hostMatcher(rule) {
  // host matching is case-insensitive
  // *.example.com
  // www.google.*
  // www.google.tld
  const isTld = rule.endsWith('.tld');
  let prefix = '';
  let base = rule;
  let suffix = '';
  let strTester;
  if (rule.startsWith('*.')) {
    base = base.slice(2);
    prefix = RE_STR_ANY;
  } else if (!isTld && (strTester = StringTest.try(rule, true))) {
    return strTester;
  }
  if (isTld) {
    base = base.slice(0, -4);
    suffix = RE_STR_TLD;
  }
  const re = RegExp(`^${prefix}${str2RE(base)}${suffix}$`, 'i');
  if (isTld) re.test = matchTld;
  return re;
}

function pathMatcher(tail) {
  const iQuery = tail.indexOf('?');
  const hasHash = tail.indexOf('#', iQuery + 1) >= 0;
  return hasHash && StringTest.try(tail)
    || RegExp(`^${str2RE(tail)}${hasHash ? '$' : `($|${iQuery >= 0 ? '#' : '[?#]'})`}`);
}

function CreateBlacklist() {
  let cache = {};
  let cacheSize = 0;
  let rules = [];
  return { reset, test };
  function emplace(accum, rule, builder) {
    return accum.get(rule) || accum.put(rule, builder(rule));
  }
  function reset(value) {
    const errors = [];
    testerBatch(true);
    if (process.env.DEBUG) {
      console.info('Reset blacklist:', value);
    }
    // XXX compatible with {Array} list in v2.6.1-
    rules = [];
    for (let text of Array.isArray(value) ? value : (value || '').split('\n')) {
      try {
        text = text.trim();
        if (!text || text.startsWith('#')) continue;
        const mode = text.startsWith('@') && text.split(/\s/, 1)[0];
        const rule = mode ? text.slice(mode.length + 1).trim() : text;
        const isInc = mode === '@include';
        const m = (isInc || mode === '@exclude') && emplace(cacheInc, rule, autoReg)
          || !mode && !rule.includes('/') && emplace(cacheMat, `*://${rule}/*`, MatchTest.try) // domain
          || emplace(cacheMat, rule, MatchTest.try); // @match and @exclude-match
        m.reject = !(mode === '@match' || isInc); // @include and @match = whitelist
        m.text = text;
        rules.push(m);
      } catch (err) {
        errors.push(err);
      }
    }
    cache = {};
    cacheSize = 0;
    testerBatch();
    return errors;
  }
  function test(url) {
    let res = cache[url];
    if (res === undefined) {
      if (curUrl !== url) setContext(url);
      res = rules.find(m => m.test(url));
      res = res?.reject && res.text;
      updateCache(url, res || false);
    }
    return res;
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
  function updateCache(key, value) {
    cache[key] = value;
    cacheSize += key.length;
    if (cacheSize > MAX_BL_CACHE_LENGTH) {
      for (const k in cache) {
        if (delete cache[k] && (cacheSize -= k.length) < MAX_BL_CACHE_LENGTH * 0.75) {
          // Reduced the cache to 75% so that this function doesn't run too often
          return;
        }
      }
    }
  }
}
