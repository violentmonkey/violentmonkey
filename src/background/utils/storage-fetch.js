import { request } from '#/common';
import storage from '#/common/storage';

/** @type { function(url, options, check): Promise<void> } or throws on error */
storage.cache.fetch = cacheOrFetch({
  init(options) {
    return { ...options, responseType: 'blob' };
  },
  async transform(response, url, options, check) {
    const [type, body] = await storage.cache.makeRaw(response, true);
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
  /** @this VMStorageBase */
  return function cacheOrFetchHandler(...args) {
    const [url] = args;
    const promise = requests[url] || (requests[url] = this::doFetch(...args));
    return promise;
  };
  /** @this VMStorageBase */
  async function doFetch(...args) {
    const [url, options] = args;
    try {
      const res = await request(url, init?.(options) || options);
      if (await isModified(res, url)) {
        const result = transform ? await transform(res, ...args) : res.data;
        await this.set(url, result);
      }
    } catch (err) {
      if (process.env.DEBUG) console.error(`Error fetching: ${url}`, err);
      throw err;
    } finally {
      delete requests[url];
    }
  }
}

async function isModified({ headers }, url) {
  const mod = headers.get('etag')
  || +new Date(headers.get('last-modified'))
  || +new Date(headers.get('date'));
  if (!mod || mod !== await storage.mod.getOne(url)) {
    if (mod) await storage.mod.set(url, mod);
    return true;
  }
}
