import * as tld from '#/common/tld';
import cache from './cache';
import { getOption, hookOptions } from './options';

tld.initTLD(true);

const RE_MATCH_PARTS = /(.*?):\/\/([^/]*)\/(.*)/;
let blacklistRules = [];
hookOptions((changes) => {
  if ('blacklist' in changes) resetBlacklist(changes.blacklist || '');
});
const RE_HTTP_OR_HTTPS = /^https?$/i;

/**
 * Test glob rules like `@include` and `@exclude`.
 */
export function testGlob(url, rules) {
  const lifetime = 60 * 1000;
  return rules.some((rule) => {
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
  return rules.some((rule) => {
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
  const re = str.replace(/([.?+[\]{}()|^$])/g, '\\$1').replace(/\*/g, '.*?');
  return re;
}

function autoReg(str) {
  if (str.length > 1 && str[0] === '/' && str[str.length - 1] === '/') {
    return new RegExp(str.slice(1, -1)); // Regular-expression
  }
  const reStr = str2RE(str);
  if (tld.isReady() && str.includes('.tld/')) {
    const reTldStr = reStr.replace('\\.tld/', '((?:\\.\\w+)+)/');
    return {
      test: (tstr) => {
        const matches = tstr.match(reTldStr);
        if (matches) {
          const suffix = matches[1].slice(1);
          if (tld.getPublicSuffix(suffix) === suffix) return true;
        }
        return false;
      },
    };
  }
  const re = new RegExp(`^${reStr}$`); // String with wildcards
  return { test: tstr => re.test(tstr) };
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
const RE_STR_TLD = '((?:\\.\\w+)+)';
function hostMatcher(rule) {
  // *.example.com
  // www.google.*
  // www.google.tld
  let prefix = '';
  let base = rule;
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
    // * matches all
    if (rule === '*') return 1;
    // exact match
    if (rule === data) return 1;
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
  const reRule = new RegExp(strRe);
  return data => reRule.test(data);
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

function checkPrefix(prefix, rule) {
  if (rule.startsWith(prefix)) {
    return rule.slice(prefix.length).trim();
  }
}

export function testBlacklist(url) {
  for (let i = 0; i < blacklistRules.length; i += 1) {
    const { test, reject } = blacklistRules[i];
    if (test(url)) return reject;
  }
}
export function resetBlacklist(list) {
  const rules = list == null ? getOption('blacklist') : list;
  if (process.env.DEBUG) {
    console.info('Reset blacklist:', rules);
  }
  // XXX compatible with {Array} list in v2.6.1-
  blacklistRules = (Array.isArray(rules) ? rules : (rules || '').split('\n'))
  .map((line) => {
    const item = line.trim();
    if (!item || item.startsWith('#')) return null;

    /**
     * @include and @match rules are added for people who need a whitelist.
     */
    // @include
    const includeRule = checkPrefix('@include ', item);
    if (includeRule) {
      return {
        test: autoReg(includeRule).test,
        reject: false,
      };
    }
    // @match
    const matchRule = checkPrefix('@match ', item);
    if (matchRule) {
      return {
        test: matchTester(matchRule).test,
        reject: false,
      };
    }

    // @exclude
    const excludeRule = checkPrefix('@exclude ', item);
    if (excludeRule) {
      return {
        test: autoReg(excludeRule).test,
        reject: true,
      };
    }
    // domains
    if (item.indexOf('/') < 0) {
      return {
        test: matchTester(`*://${item}/*`).test,
        reject: true,
      };
    }
    // @exclude-match
    return {
      test: matchTester(item).test,
      reject: true,
    };
  })
  .filter(Boolean);
}
