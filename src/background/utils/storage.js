import { mapEntry } from '@/common/object';
import { ensureArray } from '@/common/util';
import { addOwnCommands } from './message';

let api = browser.storage.local;

/** @prop {VMStorageFetch} [fetch] */
class StorageArea {
  constructor(prefix) {
    this.name = '';
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
    if (process.env.DEV && !isObject(data)) {
      throw 'StorageArea.set: data is not an object';
    }
    await api.set(this.prefix
      ? data::mapEntry(null, this.toKey, this)
      : data);
    return data;
  }
}

export const S_CACHE_PRE = 'cac:';
export const S_CODE_PRE = 'code:';
export const S_MOD_PRE = 'mod:';
export const S_REQUIRE_PRE = 'req:';
export const S_SCRIPT_PRE = 'scr:';
export const S_VALUE_PRE = 'val:';
const storage = {
  get api() { return api; },
  set api(val) { api = val; },
  /** @return {?StorageArea} */// eslint-disable-next-line no-use-before-define
  forKey: key => storageByPrefix[/^\w+:|$/.exec(key)[0]],
  base: new StorageArea(''),
  cache: new StorageArea(S_CACHE_PRE),
  code: new StorageArea(S_CODE_PRE),
  /** last-modified HTTP header value per URL */
  mod: new StorageArea(S_MOD_PRE),
  require: new StorageArea(S_REQUIRE_PRE),
  script: new StorageArea(S_SCRIPT_PRE),
  value: new StorageArea(S_VALUE_PRE),
};
/** @type {{ [prefix: string]: StorageArea }} */
export const storageByPrefix = storage::mapEntry(null, (name, val) => {
  if (val instanceof StorageArea) {
    val.name = name;
    return val.prefix;
  }
});
export const S_CACHE = storageByPrefix[S_CACHE_PRE].name;
export const S_CODE = storageByPrefix[S_CODE_PRE].name;
export const S_MOD = storageByPrefix[S_MOD_PRE].name;
export const S_REQUIRE = storageByPrefix[S_REQUIRE_PRE].name;
export const S_SCRIPT = storageByPrefix[S_SCRIPT_PRE].name;
export const S_VALUE = storageByPrefix[S_VALUE_PRE].name;
export default storage;

addOwnCommands({
  Storage([area, method, ...args]) {
    return storage[area][method](...args);
  },
});
