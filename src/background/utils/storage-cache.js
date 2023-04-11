import { ensureArray, initHooks, isEmpty } from '@/common';
import initCache from '@/common/cache';
import { INFERRED, WATCH_STORAGE } from '@/common/consts';
import { deepCopy, deepCopyDiff, deepSize, forEachEntry } from '@/common/object';
import { scriptMap, scriptSizes, sizesPrefixRe } from './db';
import storage, { S_SCRIPT, S_SCRIPT_PRE, S_VALUE } from './storage';
import { clearValueOpener } from './values';

/** Throttling browser API for `storage.value`, processing requests sequentially,
 so that we can supersede an earlier chained request if it's obsolete now,
 e.g. in a chain like [GET:foo, SET:foo=bar] `bar` will be used in GET. */
let valuesToFlush = {};
/** @type {Object<string,function[]>} */
let valuesToWatch = {};
let flushTimer = 0;
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
const { api } = storage;
const GET = 'get';
const SET = 'set';
const REMOVE = 'remove';
/** Using a simple delay with setTimeout to avoid infinite debouncing due to periodic activity */
const FLUSH_DELAY = 100;
const FLUSH_SIZE_STEP = 1e6; // each step increases delay by FLUSH_DELAY
const FLUSH_MAX_DELAY = 1000; // e.g. when writing more than 10MB for step=1MB and delay=100ms
const { hook, fire } = initHooks();

/**
 * Not using browser.storage.onChanged to improve performance, as it sends data across processes.
 * WARNING: when editing the db directly in devtools, restart the background page via Ctrl-R.
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
    batch(true);
    data::forEachEntry(([key, val]) => {
      const copy = deepCopyDiff(val, cache.get(key));
      if (copy !== undefined) {
        cache.put(key, copy);
        dbKeys.put(key, 1);
        if (storage[S_VALUE].toId(key)) {
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
    flushLater();
  },

  async [REMOVE](keys) {
    keys = keys.filter(key => {
      let ok = dbKeys.get(key) !== 0;
      if (ok) {
        cache.del(key);
        dbKeys.put(key, 0);
        if (storage[S_VALUE].toId(key)) {
          valuesToFlush[key] = null;
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
    flushLater();
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
  const id = +storage[S_SCRIPT].toId(key);
  if (id) {
    if (val) scriptMap[id] = val;
    else delete scriptMap[id];
    return true;
  }
}

async function updateScriptSizeContributor(key, val) {
  const area = sizesPrefixRe.exec(key);
  if (area && area[0] !== S_SCRIPT_PRE) {
    scriptSizes[key] = deepSize(val);
  }
}

async function flush() {
  const keys = Object.keys(valuesToFlush);
  const toRemove = [];
  const toFlush = valuesToFlush;
  valuesToFlush = {};
  flushTimer = 0;
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

function flushLater() {
  if (!flushTimer && !isEmpty(valuesToFlush)) {
    flushTimer = setTimeout(flush,
      Math.min(FLUSH_MAX_DELAY, FLUSH_DELAY * Math.max(1, deepSize(valuesToFlush) / FLUSH_SIZE_STEP)));
  }
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
