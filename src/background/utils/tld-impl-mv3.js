// This module is bundled as tld.js for MV3 in webpack.conf.js
import { TLDJS } from '@/common/consts';

export const browserPublicSuffix = browser.publicSuffix;
export let getDomainImpl = browserPublicSuffix?.getDomain || load;
export let getPublicSuffixImpl = browserPublicSuffix?.getKnownSuffix || load;

function load(url, opts, isDomain) {
  /* global importScripts */
  ({
    getDomain: getDomainImpl,
    getPublicSuffix: getPublicSuffixImpl,
  } = global.tld || (importScripts(TLDJS), global.tld));
  return (isDomain ? getDomainImpl : getPublicSuffixImpl)(url, opts);
}
