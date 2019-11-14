import { browser } from './consts';
import { request, buffer2string, ensureArray } from './util';

const base = {
  prefix: '',
  getKey(id) {
    return `${this.prefix}${id}`;
  },
  getOne(id) {
    const key = this.getKey(id);
    return browser.storage.local.get(key).then(data => data[key]);
  },
  async getMulti(ids, def) {
    const data = await browser.storage.local.get(ids.map(this.getKey, this));
    return ids.reduce((res, id) => {
      res[id] = data[this.getKey(id)] || def;
      return res;
    }, {});
  },
  set(id, value) {
    return id
      ? browser.storage.local.set({ [this.getKey(id)]: value })
      : Promise.resolve();
  },
  remove(id) {
    return id
      ? browser.storage.local.remove(this.getKey(id))
      : Promise.resolve();
  },
  removeMulti(ids) {
    return browser.storage.local.remove(ids.map(this.getKey, this));
  },
  async dump(data) {
    const output = !this.prefix
      ? data
      : Object.entries(data).reduce((res, [key, value]) => {
        res[this.getKey(key)] = value;
        return res;
      }, {});
    await browser.storage.local.set(output);
    return data;
  },
};

const cacheOrFetch = (handle) => {
  const requests = {};
  return function cachedHandle(url, ...args) {
    let promise = requests[url];
    if (!promise) {
      promise = handle.call(this, url, ...args)
      .catch((err) => {
        console.error(`Error fetching: ${url}`, err);
      })
      .then(() => {
        delete requests[url];
      });
      requests[url] = promise;
    }
    return promise;
  };
};

export default {

  base,

  cache: {
    ...base,
    prefix: 'cac:',
    fetch: cacheOrFetch(async function fetch(uri, check) {
      const { data: { buffer, xhr } } = await request(uri, { responseType: 'arraybuffer' });
      const contentType = (xhr.getResponseHeader('content-type') || '').split(';')[0];
      const data = {
        contentType,
        buffer,
        blob: options => new Blob([buffer], Object.assign({ type: contentType }, options)),
        string: () => buffer2string(buffer),
        base64: () => window.btoa(data.string()),
      };
      if (check) await check(data);
      return this.set(uri, `${contentType},${data.base64()}`);
    }),
  },

  code: {
    ...base,
    prefix: 'code:',
  },

  require: {
    ...base,
    prefix: 'req:',
    fetch: cacheOrFetch(async function fetch(uri) {
      return this.set(uri, (await request(uri)).data);
    }),
  },

  script: {
    ...base,
    prefix: 'scr:',
    async dump(items) {
      items = ensureArray(items).filter(Boolean);
      if (!items.length) return;
      const data = items.reduce((res, item) => {
        res[this.getKey(item.props.id)] = item;
        if (this.onDump) this.onDump(item);
        return res;
      }, {});
      await base.dump(data);
      return items;
    },
  },

  value: {
    ...base,
    prefix: 'val:',
  },
};
