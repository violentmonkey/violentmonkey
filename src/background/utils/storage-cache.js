import { debounce, ensureArray, initHooks, isEmpty } from '@/common';
import initCache from '@/common/cache';
import { INFERRED, WATCH_STORAGE } from '@/common/consts';
import { deepCopy, deepCopyDiff, deepSize, forEachEntry } from '@/common/object';
import { store } from './db';
import storage, { S_SCRIPT_PRE } from './storage';
import { clearValueOpener } from './values';

/** Throttling browser API for `storage.value`, processing requests sequentially,
 so that we can supersede an earlier chained request if it's obsolete now,
 e.g. in a chain like [GET:foo, SET:foo=bar] `bar` will be used in GET. */
let valuesToFlush = {};
/** @type {Object<string,function[]>} */
let valuesToWatch = {};
const watchers = {};
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
      keys?.forEach(key => dbKeys.put(key, +hasOwnProperty(res, key)));
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
          if (updateScriptMap(key, val) && val[INFERRED]) {
            delete (toWrite[key] = { ...val })[INFERRED];
          }
          updateScriptSizeContributor(key, val);
        }
      }
    });
    batch(false);
    if (keys.length) {
      await api[SET](toWrite);
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
          updateScriptSizeContributor(key);
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

window[WATCH_STORAGE] = fn => {
  const id = performance.now();
  watchers[id] = fn;
  return id;
};
browser.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith(WATCH_STORAGE)) return;
  const { id, cfg, tabId } = JSON.parse(port.name.slice(WATCH_STORAGE.length));
  const fn = id ? watchers[id] : port.postMessage.bind(port);
  watchStorage(fn, cfg);
  port.onDisconnect.addListener(() => {
    clearValueOpener(tabId);
    watchStorage(fn, cfg, false);
    delete watchers[id];
  });
});

function watchStorage(fn, cfg, state = true) {
  if (state && !valuesToWatch) {
    valuesToWatch = {};
  }
  cfg::forEachEntry(([area, ids]) => {
    const { prefix } = storage[area];
    for (const id of ensureArray(ids)) {
      const key = prefix + id;
      const list = valuesToWatch[key] || state && (valuesToWatch[key] = []);
      const i = list ? list.indexOf(fn) : -1;
      if (i >= 0 && !state) {
        list.splice(i, 1);
        if (!list.length) delete valuesToWatch[key];
      } else if (i < 0 && state) {
        list.push(fn);
      }
    }
  });
  if (isEmpty(valuesToWatch)) {
    valuesToWatch = null;
  }
}

function batch(state) {
  cache.batch(state);
  dbKeys.batch(state);
}

function updateScriptMap(key, val) {
  const id = +storage.script.toId(key);
  if (id) {
    if (val) scriptMap[id] = val;
    else delete scriptMap[id];
    return true;
  }
}

async function updateScriptSizeContributor(key, val) {
  const area = store.sizesPrefixRe.exec(key);
  if (area && area[0] !== S_SCRIPT_PRE) {
    store.sizes[key] = deepSize(val);
  }
}

async function flush() {
  const keys = Object.keys(valuesToFlush);
  const toRemove = [];
  const toFlush = valuesToFlush;
  valuesToFlush = {};
  keys.forEach(key => {
    const val = toFlush[key];
    if (!val) {
      delete toFlush[key];
      toRemove.push(key);
    }
    updateScriptSizeContributor(key, val);
  });
  if (!isEmpty(toFlush)) await api[SET](toFlush);
  if (toRemove.length) await api[REMOVE](toRemove);
  if (valuesToWatch) setTimeout(notifyWatchers, 0, toFlush, toRemove);
  fire({ keys });
}

function notifyWatchers(toFlush, toRemove) {
  const byFn = new Map();
  let newValue;
  let changes;
  for (const key in valuesToWatch) {
    if ((newValue = toFlush[key]) || toRemove.includes(key)) {
      for (const fn of valuesToWatch[key]) {
        if (!(changes = byFn.get(fn))) byFn.set(fn, changes = {});
        changes[key] = { newValue };
      }
    }
  }
  byFn.forEach((val, fn) => fn(val));
}
