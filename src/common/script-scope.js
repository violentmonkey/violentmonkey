/**
 * Detects scripts that run on every website, so the UI can flag them.
 * A pattern counts when its host is `*` and it has no specific path.
 * Excludes are ignored on purpose: a script with a few excludes still
 * runs on almost every site.
 */

const BROAD_GLOBS = ['*', 'http*', 'https*'];
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
  const [,, host, path] = str.split('/', 4);
  return host === '*' && (!path || path === '*'); // specific paths like /recaptcha don't apply to all sites
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
