import { buffer2string, request } from '#/common';
import storage from '#/common/storage';

/** @type { function(url, options, check): Promise<void> } or throws on error */
storage.cache.fetch = cacheOrFetch({
  init(options) {
    return { ...options, responseType: 'arraybuffer' };
  },
  async transform(response, url, options, check) {
    const contentType = response.headers.get('content-type')?.[0];
    await check?.(url, response.data, contentType);
    return `${contentType},${btoa(buffer2string(response.data))}`;
  },
});

/** @type { function(url, options): Promise<void> } or throws on error */
storage.require.fetch = cacheOrFetch();

function cacheOrFetch(handlers = {}) {
  const requests = {};
  const { init, transform } = handlers;
  /** @this storage.<area> */
  return function cacheOrFetchHandler(...args) {
    const [url] = args;
    const promise = requests[url] || (requests[url] = this::doFetch(...args));
    return promise;
  };
  /** @this storage.<area> */
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

async function isModified(res, url) {
  const mod = res.headers.get('etag')?.[0]?.trim()
  || +new Date(res.headers.get('last-modified')?.[0])
  || +new Date(res.headers.get('date')?.[0]);
  if (!mod || mod !== await storage.mod.getOne(url)) {
    if (mod) await storage.mod.set(url, mod);
    return true;
  }
}
