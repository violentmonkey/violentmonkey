/**
 * Detects scripts that run on every website, so the UI can flag them.
 * Excludes are ignored on purpose: a script with a few excludes still
 * runs on almost every site.
 */

const BROAD_GLOBS = ['*', 'http*', 'https*', 'http*://*', '*://*'];
const BROAD_REGEXPS = ['.*', '^.*$', '^https?://.*', '^https?:\\/\\/.*', 'https?://.*'];

/**
 * @param {string} pattern - a @match pattern, an @include glob or an @include /regexp/
 * @return {boolean}
 */
export function isAllSitesPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const str = pattern.trim();
  if (str === '<all_urls>' || BROAD_GLOBS.includes(str)) return true;
  if (str.length > 2 && str[0] === '/' && str.endsWith('/')) {
    return BROAD_REGEXPS.includes(str.slice(1, -1));
  }
  const m = str.match(/^([^:/]*):\/\/([^/]*)(.*)$/);
  if (!m) return false;
  const [, scheme, host, path] = m;
  return /^(\*|https?|http\*|https?\*)$/.test(scheme)
    && host === '*'
    && (!path || path === '/*' || path === '*');
}

/**
 * @param {{meta: Object, custom?: Object}} script
 * @return {boolean}
 */
export function runsOnAllSites({ meta, custom = {} }) {
  return !!(
    custom.origMatch !== false && meta.match?.some(isAllSitesPattern)
    || custom.match?.some(isAllSitesPattern)
    || custom.origInclude !== false && meta.include?.some(isAllSitesPattern)
    || custom.include?.some(isAllSitesPattern)
  );
}
