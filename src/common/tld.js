import { getDomain as getDomain_, getPublicSuffix as getPublicSuffix_ } from 'tldts';

/**
 * tldts does not respect the public suffix list by default, but can be opt in manually
 * with the option `allowPrivateDomains`. Hoist the `sharedOpts` can also help avoid
 * re-creating the object every time.
 */
const sharedOpts = { allowPrivateDomains: true };
export const getDomain = url => getDomain_(url, sharedOpts);
export const getPublicSuffix = url => getPublicSuffix_(url, sharedOpts);
