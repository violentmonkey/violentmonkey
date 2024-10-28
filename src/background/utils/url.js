import { isCdnUrlRe, isDataUri, isRemote, makeRaw, request, tryUrl } from '@/common';
import { VM_HOME } from '@/common/consts';
import limitConcurrency from '@/common/limit-concurrency';
import { addOwnCommands } from './init';
import { testBlacklistNet } from './tester';

export const requestLimited = limitConcurrency(request, 4, 100, 1000,
  url => url.split('/')[2] // simple extraction of the `host` part
);

addOwnCommands({
  async Request({ url, vet, ...opts }) {
    const vettedUrl = vet ? vetUrl(url) : url;
    const fn = isRemote(vettedUrl) && !isCdnUrlRe.test(vettedUrl)
      ? requestLimited
      : request;
    const res = await fn(vettedUrl, opts);
    if (opts[kResponseType] === 'blob') {
      res.data = await makeRaw(res);
    }
    return res;
  },
});

/**
 * @param {string} url
 * @param {string} [base]
 * @param {boolean} [throwOnFailure]
 * @returns {string} a resolved `url` or `data:,Invalid URL ${url}`
 */
export function vetUrl(url, base = VM_HOME, throwOnFailure) {
  let res, err;
  if (isDataUri(url)) {
    res = url;
  } else {
    res = tryUrl(url, base);
    err = !res ? 'Invalid'
      : (res.startsWith(extensionRoot) || testBlacklistNet(res)) && 'Blacklisted';
    if (err) {
      err = `${err} URL ${res || url}`;
      if (throwOnFailure) throw err;
      res = `data:,${err}`;
    }
  }
  return res;
}
