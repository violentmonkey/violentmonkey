import { isCdnUrlRe, isRemote, makeRaw, request } from '@/common';
import { VM_HOME } from '@/common/consts';
import limitConcurrency from '@/common/limit-concurrency';
import { addOwnCommands } from './init';
import { testBlacklistNet } from './tester';

export const requestLimited = limitConcurrency(request, 4, 100, 1000,
  url => url.split('/')[2] // simple extraction of the `host` part
);

addOwnCommands({
  async Request({ url, ...opts }) {
    const vettedUrl = vetUrl(url);
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
  try {
    res = new URL(url, base).href;
    if (res.startsWith(extensionRoot) || testBlacklistNet(res)) {
      err = 'Blacklisted';
    }
  } catch {
    err = 'Invalid';
  }
  if (err) {
    err = `${err} URL ${res || url}`;
    if (throwOnFailure) throw err;
    res = `data:,${err}`;
  }
  return res;
}
