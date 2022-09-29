import { isDataUri, makeRaw, request } from '@/common';
import storage from './storage';

/** @type { function(url, options, check): Promise<void> } or throws on error */
storage.cache.fetch = cacheOrFetch({
  init(options) {
    return { ...options, responseType: 'blob' };
  },
  async transform(response, url, options, check) {
    const [type, body] = await makeRaw(response, true);
    await check?.(url, response.data, type);
    return `${type},${body}`;
  },
});

/** @type { function(url, options): Promise<void> } or throws on error */
storage.require.fetch = cacheOrFetch({
  transform: ({ data }, url) => (
    /^\s*</.test(data)
      ? Promise.reject(`NOT_JS: ${url} "${data.slice(0, 100).trim().replace(/\s{2,}/g, ' ')}"`)
      : data
  ),
});

function cacheOrFetch(handlers = {}) {
  const requests = {};
  const { init, transform } = handlers;
  /** @this StorageArea */
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
      }
    } finally {
      delete requests[url];
    }
  }
}

export async function requestNewer(url, opts) {
  if (isDataUri(url)) {
    return;
  }
  const modOld = await storage.mod.getOne(url);
  for (const get of [0, 1]) {
    if (modOld || get) {
      const req = await request(url, !get ? { ...opts, method: 'HEAD' } : opts);
      const { headers } = req;
      // headers does not exist when requesting a local file
      const mod = headers && (
        headers.get('etag')
        || +new Date(headers.get('last-modified'))
        || +new Date(headers.get('date'))
      );
      if (mod && mod === modOld) {
        return;
      }
      if (get) {
        if (mod) storage.mod.setOne(url, mod);
        else if (modOld) storage.mod.remove(url);
        return req;
      }
    }
  }
}
