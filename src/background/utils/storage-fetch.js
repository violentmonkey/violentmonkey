import { isCdnUrlRe, isDataUri, isRemote, makeRaw, request } from '@/common';
import { NO_CACHE } from '@/common/consts';
import storage from './storage';
import { getUpdateInterval } from './update';
import { requestLimited } from './url';

storage.cache.fetch = cacheOrFetch({
  init: options => ({ ...options, [kResponseType]: 'blob' }),
  transform: response => makeRaw(response),
});

storage.require.fetch = cacheOrFetch({
  transform: ({ data }, url) => (
    /^\s*</.test(data)
      ? Promise.reject(`NOT_JS: ${url} "${data.slice(0, 100).trim().replace(/\s{2,}/g, ' ')}"`)
      : data
  ),
});

storage.code.fetch = cacheOrFetch();

/** @return {VMStorageFetch} */
function cacheOrFetch(handlers = {}) {
  const requests = {};
  const { init, transform } = handlers;
  return function cacheOrFetchHandler(...args) {
    const [url] = args;
    const promise = requests[url] || (requests[url] = this::doFetch(...args));
    return promise;
  };
  /** @this StorageArea */
  async function doFetch(...args) {
    const [url, options] = args;
    try {
      const res = await requestNewer(url, init ? init(options) : options);
      if (res) {
        const result = transform ? await transform(res, ...args) : res.data;
        await this.setOne(url, result);
        if (options === 'res') {
          return result;
        }
      }
    } finally {
      delete requests[url];
    }
  }
}

/**
 * @param {string} url
 * @param {VMReq.OptionsMulti} [opts]
 * @return {Promise<VMReq.Response> | void}
 */
export async function requestNewer(url, opts) {
  if (isDataUri(url)) {
    return;
  }
  let multi, modOld, modDate;
  const isLocal = !isRemote(url);
  if (!isLocal && opts && (multi = opts[MULTI])
  && isObject(modOld = await storage.mod.getOne(url))) {
    [modOld, modDate] = modOld;
  }
  if (multi === AUTO && modDate > Date.now() - getUpdateInterval()) {
    return;
  }
  for (const get of multi ? [0, 1] : [1]) {
    if (modOld || get) {
      const req = await (isLocal || isCdnUrlRe.test(url) ? request : requestLimited)(url,
        get ? opts
          : { ...opts, ...NO_CACHE, method: 'HEAD' });
      const { headers } = req;
      const mod = (
        headers.get('etag')
        || +new Date(headers.get('last-modified'))
        || +new Date(headers.get('date'))
      );
      if (mod && mod === modOld) {
        return;
      }
      if (get) {
        if (mod) storage.mod.setOne(url, [mod, Date.now()]);
        else if (modOld) storage.mod.remove(url);
        return req;
      }
    }
  }
}
