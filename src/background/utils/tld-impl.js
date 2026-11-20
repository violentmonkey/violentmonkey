import browser from '@/common/browser';
import { getDomain, getPublicSuffix } from 'tldts';

export const browserPublicSuffix = browser.publicSuffix;
export let getDomainImpl = browserPublicSuffix?.getDomain || getDomain;
export let getPublicSuffixImpl = browserPublicSuffix?.getKnownSuffix || getPublicSuffix;
