import { deepCopy, forEachEntry } from '#/common/object';
import { blob2base64, ensureArray } from './util';

const browserStorageLocal = browser.storage.local;
/** @type VMCache */
let dataCache;

const base = {
  prefix: '',
  setDataCache(val) {
    dataCache = val;
  },
  getKey(id) {
    return `${this.prefix}${id}`;
  },
  getOne(id) {
    const key = this.getKey(id);
    return dataCache?.has(key) ? deepCopy(dataCache.get(key))
      : browserStorageLocal.get(key).then(data => data[key]);
  },
  /**
   * @param {string[]} ids
   * @param {?} def
   * @param {function(id:string, val:?):?} transform
   * @returns {Promise<Object>}
   */
  async getMulti(ids, def, transform) {
    const data = {};
    const keys = [];
    ids.forEach(id => {
      const key = this.getKey(id);
      const isCached = dataCache?.has(key);
      if (isCached) data[key] = deepCopy(dataCache.get(key));
      else keys.push(key);
    });
    if (keys.length) {
      Object.assign(data, await browserStorageLocal.get(keys));
    }
    return ids.reduce((res, id) => {
      const val = data[this.getKey(id)];
      res[id] = transform ? transform(id, val) : (val || def);
      return res;
    }, {});
  },
  // Must be `async` to ensure a Promise is returned when `if` doesn't match
  async set(id, value) {
    if (id) {
      const key = this.getKey(id);
      dataCache?.put(key, deepCopy(value));
      return browserStorageLocal.set({ [key]: value });
    }
  },
  // Must be `async` to ensure a Promise is returned when `if` doesn't match
  async remove(id) {
    if (id) return this.removeMulti([id]);
  },
  // Must be `async` to ensure a Promise is returned when `if` doesn't match
  async removeMulti(ids) {
    if (ids.length) {
      const keys = ids.map(this.getKey, this);
      if (dataCache) keys.forEach(dataCache.del);
      return browserStorageLocal.remove(keys);
    }
  },
  async dump(data) {
    const output = {};
    data::forEachEntry(([key, value]) => {
      key = this.getKey(key);
      output[key] = value;
      dataCache?.put(key, deepCopy(value));
    });
    await browserStorageLocal.set(output);
    return data;
  },
};

export default {

  base,

  cache: {
    ...base,
    prefix: 'cac:',
    /**
     * @param {VMRequestResponse} response
     * @param {boolean} [noJoin]
     * @returns {string|string[]}
     */
    async makeRaw(response, noJoin) {
      const type = (response.headers.get('content-type') || '').split(';')[0] || '';
      const body = await blob2base64(response.data);
      return noJoin ? [type, body] : `${type},${body}`;
    },
    /**
     * @param {string} url
     * @param {string} [raw] - raw value in storage.cache
     * @returns {?string}
     */
    makeDataUri(url, raw) {
      if (url.startsWith('data:')) return url;
      if (/^(i,|image\/)/.test(raw)) { // workaround for bugs in old VM, see 2e135cf7
        const i = raw.lastIndexOf(',');
        const type = raw.startsWith('image/') ? raw.slice(0, i) : 'image/png';
        return `data:${type};base64,${raw.slice(i + 1)}`;
      }
      return raw;
    },
  },

  code: {
    ...base,
    prefix: 'code:',
  },

  // last-modified HTTP header value per URL
  mod: {
    ...base,
    prefix: 'mod:',
  },

  require: {
    ...base,
    prefix: 'req:',
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
