import { escapeStringForRegExp } from '@/common';
import { kTag } from '@/common/consts';

const reToken = re`/\s*
  (!)?
  (
    \# |
    (name|code|desc)(\+re)?: |
    (re:) |
  )
  (
    '((?:[^']+|'')*) ('|$) |
    "((?:[^"]+|"")*) ("|$) |
    \/(\S+?)\/([a-z]*) |
    \S+
  )
  (?:\s+|$)
/yx`;
const reTwoSingleQuotes = /''/g;
const reTwoDoubleQuotes = /""/g;

export function createSearchRules(search) {
  /** @type {VMSearchRule[]} */
  const rules = [];
  const tokens = [];
  const includeTags = [];
  const excludeTags = [];
  reToken.lastIndex = 0;
  for (let m; (m = reToken.exec(search)); ) {
    let [,
      negative,
      prefix, scope = '', re1, re2,
      raw,
      q1, q1end,
      quoted = q1, quoteEnd = q1end,
      reStr, flags = '',
    ] = m;
    let str;
    if (quoted) {
      if (!quoteEnd) throw new Error('Unmatched quotes');
      str = quoted.replace(q1 ? reTwoSingleQuotes : reTwoDoubleQuotes, quoted[0]);
    } else {
      str = raw;
    }
    negative = !!negative;
    tokens.push({
      negative,
      prefix,
      raw,
      parsed: str,
    });
    if (prefix === '#') {
      if (str) (negative ? excludeTags : includeTags).push(str);
    } else {
      if (re1 || re2) {
        flags = 'i';
      } else if (reStr) {
        str = reStr;
      } else {
        if (!quoted) flags = 'i';
        str = escapeStringForRegExp(str);
      }
      /** @namespace VMSearchRule */
      rules.push({
        negative,
        scope,
        re: new RegExp(str, flags.includes('u') ? flags : flags + 'u'),
      });
    }
  }
  [includeTags, excludeTags].forEach((tags, negative) => {
    if (tags.length) {
      rules.unshift({
        scope: kTag,
        // searching anywhere in a tag to enable incremental search
        re: RegExp(tags.map(escapeStringForRegExp).join('|'), 'i'),
        negative: !!negative,
      });
    }
  });
  return {
    tokens,
    rules,
  };
}

/**
 * @this {Object} $cache, see initScript()
 * @param {VMSearchRule} rule
 * @return {number}
 */
export function testSearchRule({ re, negative, scope }) {
  return negative ^ (
    (scope === kTag
      ? this[kTag].some(re.test, re)
      : re.test(this[scope || 'desc'])
    ) || !scope && re.test(this.code)
  );
}

export function performSearch(scripts, rules) {
  let res = 0;
  for (const { $cache } of scripts) {
    res += ($cache.show = rules.every(testSearchRule, $cache));
  }
  return res;
}
