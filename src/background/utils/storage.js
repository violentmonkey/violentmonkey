import { mapEntry } from '@/common/object';
import { ensureArray } from '@/common/util';
import { commands } from './message';

let api = browser.storage.local;

class StorageArea {
  constructor(prefix) {
    this.name = '';
    this.prefix = prefix;
  }

  /** @return {string} */
  toKey(id) {
    return this.prefix + id;
  }

  /** @return {?string} */
  toId(key) {
    if (key.startsWith(this.prefix)) return key.slice(this.prefix.length);
  }

  async getOne(id) {
    const key = this.toKey(id);
    const data = await api.get([key]);
    return data[key];
  }

  /**
   * @param {?string[]} [ids] - if null/absent, the entire storage is returned
   * @param {function(val:?,key:string):?} [transform]
   * @return {Promise<?>} - single value or object of id:value
   */
  async getMulti(ids, transform) {
    const keys = ids?.map(this.toKey, this);
    const data = await api.get(keys);
    return transform || this.prefix
      ? data::mapEntry(transform, this.toId, this)
      : data;
  }

  /**
   * @param {string|number|Array<string|number>} id
   * @return {Promise<void>}
   */
  async remove(id) {
    const keys = ensureArray(id).filter(Boolean).map(this.toKey, this);
    if (keys.length) await api.remove(keys);
  }

  async setOne(id, value) {
    if (id) return this.set({ [id]: value });
  }

  /**
   * @param {Object} data
   * @return {Promise<Object>} same object
   */
  async set(data) {
    if (process.env.DEV && (!data || typeof data !== 'object')) {
      throw 'StorageArea.set: data is not an object';
    }
    await api.set(this.prefix
      ? data::mapEntry(null, this.toKey, this)
      : data);
    return data;
  }
}

const storage = {
  get api() { return api; },
  set api(val) { api = val; },
  base: new StorageArea(''),
  cache: new StorageArea('cac:'),
  code: new StorageArea('code:'),
  /** last-modified HTTP header value per URL */
  mod: new StorageArea('mod:'),
  require: new StorageArea('req:'),
  script: new StorageArea('scr:'),
  value: new StorageArea('val:'),
};
storage::mapEntry((val, name) => {
  if (val instanceof StorageArea) {
    val.name = name;
  }
});
export default storage;

Object.assign(commands, {
  Storage([area, method, ...args]) {
    return storage[area][method](...args);
  },
});
