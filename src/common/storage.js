import { browser } from './consts';
import { buffer2string, ensureArray } from './util';

const base = {
  prefix: '',
  getKey(id) {
    return `${this.prefix}${id}`;
  },
  getOne(id) {
    const key = this.getKey(id);
    return browser.storage.local.get(key).then(data => data[key]);
  },
  /**
   * @param {string[]} ids
   * @param {?} def
   * @param {function(id:string, val:?):?} transform
   * @returns {Promise<Object>}
   */
  async getMulti(ids, def, transform) {
    const data = await browser.storage.local.get(ids.map(this.getKey, this));
    return ids.reduce((res, id) => {
      const val = data[this.getKey(id)];
      res[id] = transform ? transform(id, val) : (val || def);
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
    return ids.length
      ? browser.storage.local.remove(ids.map(this.getKey, this))
      : Promise.resolve();
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

export default {

  base,

  cache: {
    ...base,
    prefix: 'cac:',
    /**
     * @param {Response} response
     * @param {boolean} [noJoin]
     * @returns {string|string[]}
     */
    makeRaw(response, noJoin) {
      const type = (response.headers.get('content-type') || '').split(';')[0] || '';
      const body = btoa(buffer2string(response.data));
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
