import { normalizeTag } from '@/common';

export function parseSearch(search) {
  /**
   * @type Array<{
   *   prefix: string;
   *   raw: string;
   *   negative: boolean;
   * }>
   */
  const tokens = [];
  search = search.toLowerCase();
  let offset = 0;
  while (search[offset] === ' ') offset += 1;
  while (offset < search.length) {
    const negative = search[offset] === '!';
    if (negative) offset += 1;
    const prefix =
      search.slice(offset).match(/^(#|re:|(?:name|code)(?:\+re)?:)/)?.[1] || '';
    if (prefix) offset += prefix.length;
    const startOffset = offset;
    const quote =
      (!prefix || prefix.endsWith(':')) &&
      search.slice(offset).match(/^['"]/)?.[0];
    if (quote) offset += 1;
    let pattern = '';
    const endChar = quote || ' ';
    while (offset < search.length) {
      const ch = search[offset];
      if (quote && ch === quote && search[offset + 1] === quote) {
        // escape quotes by double it
        pattern += quote;
        offset += 2;
      } else if (ch !== endChar) {
        pattern += ch;
        offset += 1;
      } else {
        break;
      }
    }
    if (quote) {
      if (offset < search.length) offset += 1;
      else throw new Error('Unmatched quotes');
    }
    tokens.push({
      prefix,
      raw: search.slice(startOffset, offset),
      parsed: pattern,
      negative,
    });
    while (search[offset] === ' ') offset += 1;
  }
  return tokens;
}

export function createSearchRules(search) {
  const tokens = parseSearch(search);
  /**
   * @type Array<{
   *   scope: string;
   *   pattern: string | RegExp;
   *   negative: boolean;
   * }>
   */
  const rules = [];
  const includeTags = [];
  const excludeTags = [];
  for (const token of tokens) {
    if (token.prefix === '#') {
      (token.negative ? excludeTags : includeTags).push(token.parsed);
    } else {
      // Strip ':'
      let scope = token.prefix.slice(0, -1);
      let pattern = token.parsed;
      if (/(?:^|\+)re$/.test(scope)) {
        scope = scope.slice(0, -3);
        pattern = new RegExp(pattern, 'i');
      } else {
        const reMatches = pattern.match(/^\/(.*?)\/(\w*)$/);
        if (reMatches) pattern = new RegExp(reMatches[1], reMatches[2] || 'i');
      }
      rules.push({
        scope,
        pattern,
        negative: token.negative,
      });
    }
  }
  [includeTags, excludeTags].forEach((tags, negative) => {
    const sanitizedTags = tags
      .map((tag) => normalizeTag(tag).replace(/\./g, '\\.'))
      .filter(Boolean)
      .join('|');
    if (sanitizedTags) {
      rules.unshift({
        scope: 'tags',
        pattern: new RegExp(`(?:^|\\s)(${sanitizedTags})(\\s|$)`),
        negative: !!negative,
      });
    }
  });
  return {
    tokens,
    rules,
  };
}

export function testSearchRule(rule, data) {
  const { pattern, negative } = rule;
  const result =
    typeof pattern.test === 'function'
      ? pattern.test(data)
      : data.includes(pattern);
  return negative ^ result;
}
