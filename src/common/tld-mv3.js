import { TLDJS } from '@/common/consts';

// TODO: make a webpack plugin to convert the static import into an on-demand importScripts()
export let getDomain = url => load(url, true);
export let getPublicSuffix = url => load(url);
let getDomain_, getPublicSuffix_;
let load = (url_, isDomain) => {
  ({
    getDomain: getDomain_,
    getPublicSuffix: getPublicSuffix_,
  } = global.tld || (global.importScripts(TLDJS), global.tld));
  getDomain = url => getDomain_(url, { allowPrivateDomains: true });
  getPublicSuffix = url => getPublicSuffix_(url, { allowPrivateDomains: true });
  return (isDomain ? getDomain : getPublicSuffix)(url_);
};
