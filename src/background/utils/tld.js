import { browserPublicSuffix, getDomainImpl, getPublicSuffixImpl } from './tld-impl';

export const getDomain = browserPublicSuffix || !__.MV3/* MV2 doesn't need isDomain for load() */
  ? host => getDomainImpl(host, opts)
  : host => getDomainImpl(host, opts, /*isDomain=*/true);
export const getPublicSuffix = browserPublicSuffix
  ? host => getPublicSuffixImpl(host)
  : host => getPublicSuffixImpl(host, opts);

const opts = browserPublicSuffix
  ? { allowUnknownSuffix: true, encoding: 'display' }
  : { allowPrivateDomains: true };
