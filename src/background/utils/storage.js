import { mapEntry } from '@/common/object';
import { ensureArray } from '@/common/util';
import { addOwnCommands } from './init';

let api = browser.storage.local;

/** @prop {VMStorageFetch} [fetch] */
class StorageArea {
  constructor(name, prefix) {
    storageByPrefix[prefix] = this; // eslint-disable-line no-use-before-define
    this.name = name;
    this.prefix = prefix;
  }

  /** @return {string} */
  toKey(id) {
    return this.prefix + id;
  }

  /** @return {string} */
  toId(key) {
    return key.startsWith(this.prefix)
      ? key.slice(this.prefix.length)
      : '';
  }

  /**
   * @param {string|number} id
   * @return {Promise<?>}
   */
  async getOne(id) {
    const key = this.toKey(id);
    return (await api.get([key]))[key];
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
    if (process.env.DEV && !isObject(data)) {
      throw 'StorageArea.set: data is not an object';
    }
    await api.set(this.prefix
      ? data::mapEntry(null, this.toKey, this)
      : data);
    return data;
  }
}

export const S_CACHE = 'cache';
export const S_CACHE_PRE = 'cac:';
export const S_CODE = 'code';
export const S_CODE_PRE = 'code:';
export const S_MOD = 'mod';
export const S_MOD_PRE = 'mod:';
export const S_REQUIRE = 'require';
export const S_REQUIRE_PRE = 'req:';
export const S_SCRIPT = 'script';
export const S_SCRIPT_PRE = 'scr:';
export const S_VALUE = 'value';
export const S_VALUE_PRE = 'val:';
/** @type {{ [prefix: string]: StorageArea }} */
export const storageByPrefix = {};
/**
 * @prop {StorageArea} cache
 * @prop {StorageArea} code
 * @prop {StorageArea} mod
 * @prop {StorageArea} require
 * @prop {StorageArea} script
 * @prop {StorageArea} value
 */
const storage = {
  get api() { return api; },
  set api(val) { api = val; },
  /** @return {?StorageArea} */// eslint-disable-next-line no-use-before-define
  forKey: key => storageByPrefix[/^\w+:|$/.exec(key)[0]],
  base: new StorageArea('base', ''),
  [S_CACHE]: new StorageArea(S_CACHE, S_CACHE_PRE),
  [S_CODE]: new StorageArea(S_CODE, S_CODE_PRE),
  /** last-modified HTTP header value per URL */
  [S_MOD]: new StorageArea(S_MOD, S_MOD_PRE),
  [S_REQUIRE]: new StorageArea(S_REQUIRE, S_REQUIRE_PRE),
  [S_SCRIPT]: new StorageArea(S_SCRIPT, S_SCRIPT_PRE),
  [S_VALUE]: new StorageArea(S_VALUE, S_VALUE_PRE),
};
export default storage;

addOwnCommands({
  Storage([area, method, ...args]) {
    return storage[area][method](...args);
  },
});
