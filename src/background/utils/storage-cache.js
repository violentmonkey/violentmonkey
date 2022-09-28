import { debounce, initHooks, isEmpty } from '@/common';
import initCache from '@/common/cache';
import { deepCopy, deepCopyDiff, forEachEntry } from '@/common/object';
import storage from '@/common/storage';
import { store } from './db';

/** Throttling browser API for `storage.value`, processing requests sequentially,
 so that we can supersede an earlier chained request if it's obsolete now,
 e.g. in a chain like [GET:foo, SET:foo=bar] `bar` will be used in GET. */
let valuesToFlush = {};
/** Reading the entire db in init/vacuum/sizing shouldn't be cached for long. */
const TTL_SKIM = 5e3;
/** Keeping data for long time since chrome.storage.local is insanely slow in Chrome,
 * so reading just a few megabytes would inject all scripts after document-end. */
const TTL_MAIN = 3600e3;
/** Keeping tiny info for extended period of time as it's inexpensive. */
const TTL_TINY = 24 * 3600e3;
const cache = initCache({ lifetime: TTL_MAIN });
const dbKeys = initCache({ lifetime: TTL_TINY }); // 1: exists, 0: known to be absent
const { scriptMap } = store;
const { api } = storage;
const GET = 'get';
const SET = 'set';
const REMOVE = 'remove';
const flushLater = debounce(flush, 200);
const { hook, fire } = initHooks();

/**
 * Not using browser.storage.onChanged to improve performance, as it sends data across processes,
 * so if someone wants to edit the db in devtools they need to restart the background page.
*/
export const onStorageChanged = hook;
export const clearStorageCache = () => {
  cache.destroy();
  dbKeys.destroy();
};

storage.api = {

  async [GET](keys) {
    const res = {};
    batch(true);
    keys = keys?.filter(key => {
      const cached = cache.get(key);
      const ok = cached !== undefined;
      if (ok) res[key] = deepCopy(cached);
      return !ok && dbKeys.get(key) !== 0;
    });
    if (!keys || keys.length) {
      (await api[GET](keys))::forEachEntry(([key, val]) => {
        res[key] = val;
        dbKeys.put(key, 1);
        cache.put(key, deepCopy(val), !keys && TTL_SKIM);
        updateScriptMap(key, val);
      });
      keys?.forEach(key => dbKeys.put(key, +res::hasOwnProperty(key)));
    }
    batch(false);
    return res;
  },

  async [SET](data) {
    const toWrite = {};
    const keys = [];
    let unflushed;
    batch(true);
    data::forEachEntry(([key, val]) => {
      const copy = deepCopyDiff(val, cache.get(key));
      if (copy !== undefined) {
        cache.put(key, copy);
        dbKeys.put(key, 1);
        if (storage.value.toId(key)) {
          unflushed = true;
          valuesToFlush[key] = copy;
        } else {
          keys.push(key);
          toWrite[key] = val;
          updateScriptMap(key, val);
        }
      }
    });
    batch(false);
    if (keys.length) {
      await api.set(toWrite);
      fire({ keys });
    }
    if (unflushed) flushLater();
  },

  async [REMOVE](keys) {
    let unflushed;
    keys = keys.filter(key => {
      let ok = dbKeys.get(key) !== 0;
      if (ok) {
        cache.del(key);
        dbKeys.put(key, 0);
        if (storage.value.toId(key)) {
          valuesToFlush[key] = null;
          unflushed = true;
          ok = false;
        } else {
          updateScriptMap(key);
        }
      }
      return ok;
    });
    if (keys.length) {
      await api[REMOVE](keys);
      fire({ keys });
    }
    if (unflushed) {
      flushLater();
    }
  },
};

function batch(state) {
  cache.batch(state);
  dbKeys.batch(state);
}

function updateScriptMap(key, val) {
  const id = +storage.script.toId(key);
  if (id) {
    if (val) scriptMap[id] = val;
    else delete scriptMap[id];
  }
}

function flush() {
  const keys = Object.keys(valuesToFlush);
  const toRemove = keys.filter(key => !valuesToFlush[key] && delete valuesToFlush[key]);
  if (!isEmpty(valuesToFlush)) api.set(valuesToFlush);
  if (toRemove.length) api.remove(toRemove);
  valuesToFlush = {};
  fire({ keys });
}
