export function createSearchRules(search) {
  const tagLists = [[], []];
  /**
   * @type Array<{
   *   scope: string;
   *   pattern: string | RegExp;
   *   negative: boolean;
   * }>
   */
  const rules = [];
  search = search.toLowerCase();
  let offset = 0;
  while (search[offset] === ' ') offset += 1;
  while (offset < search.length) {
    const negative = search[offset] === '!';
    if (negative) offset += 1;
    let prefix =
      search.slice(offset).match(/^(#|re:|(?:name|code)(?:\+re)?:)/)?.[1] || '';
    if (prefix) offset += prefix.length;
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
    if (prefix === '#') {
      tagLists[+negative].push(pattern);
    } else {
      // Strip ':'
      prefix = prefix.slice(0, -1);
      if (/(?:^|\+)re$/.test(prefix)) {
        prefix = prefix.slice(0, -3);
        rules.push({
          scope: prefix,
          pattern: new RegExp(pattern, 'i'),
          negative,
        });
      } else {
        const reMatches = pattern.match(/^\/(.*?)\/(\w*)$/);
        if (reMatches) pattern = new RegExp(reMatches[1], reMatches[2] || 'i');
        rules.push({
          scope: prefix,
          pattern,
          negative,
        });
      }
    }
    while (search[offset] === ' ') offset += 1;
  }
  for (let negative = 0; negative < 2; negative += 1) {
    const tags = tagLists[negative];
    if (tags.length) {
      const sanitizedTags = tags
        .map((tag) => tag.replace(/[^\w.-]/g, '').replace(/\./g, '\\.'))
        .filter(Boolean)
        .join('|');
      rules.unshift({
        scope: 'tags',
        pattern: new RegExp(`(?:^|\\s)(${sanitizedTags})(\\s|$)`),
        negative: !!negative,
      });
    }
  }
  return rules;
}

export function testSearchRule(rule, data) {
  const { pattern, negative } = rule;
  const result =
    typeof pattern.test === 'function'
      ? pattern.test(data)
      : data.includes(pattern);
  return negative ^ result;
}
