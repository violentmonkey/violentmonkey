import { deepCopy, forEachEntry } from '#/common/object';
import { blob2base64, ensureArray } from './util';

/** @type VMCache */
let dataCache;
const browserStorageLocal = browser.storage.local;
const onStorageChanged = changes => {
  changes::forEachEntry(([key, { newValue }]) => {
    if (newValue == null) {
      dataCache.del(key);
    } else {
      dataCache.put(key, newValue);
    }
  });
};

const base = {
  prefix: '',
  setDataCache(val) {
    dataCache = val;
    browser.storage.onChanged.addListener(onStorageChanged);
  },
  getKey(id) {
    return `${this.prefix}${id}`;
  },
  async getOne(id) {
    return (await this.getMulti([id]))[id];
  },
  /**
   * @param {string[]} ids
   * @param {?} [def]
   * @param {function(id:string, val:?):?} [transform]
   * @returns {Promise<Object>}
   */
  async getMulti(ids, def, transform) {
    const res = {};
    const data = {};
    const missingKeys = [];
    ids.forEach(id => {
      const key = this.getKey(id);
      const cached = dataCache?.get(key);
      res[id] = key;
      if (cached != null) {
        data[key] = deepCopy(cached);
      } else {
        missingKeys.push(key);
      }
    });
    if (missingKeys.length) {
      Object.assign(data, await browserStorageLocal.get(missingKeys));
    }
    res::forEachEntry(([id, key]) => {
      res[id] = transform
        ? transform(id, data[key])
        : data[key] ?? deepCopy(def);
    });
    return res;
  },
  // Must be `async` to ensure a Promise is returned when `if` doesn't match
  async set(id, value) {
    if (id) return this.dump({ [id]: value });
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
    data::forEachEntry(([id, value]) => {
      const key = this.getKey(id);
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
