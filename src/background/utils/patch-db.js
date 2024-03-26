import { getDefaultCustom, parseMeta } from './script';
import storage, { S_CACHE, S_CODE, S_REQUIRE, S_SCRIPT, S_VALUE } from './storage';

export default () => new Promise((resolve, reject) => {
  const defaultCustom = getDefaultCustom();
  console.info('Upgrade database...');
  init();
  function init() {
    const req = indexedDB.open(VIOLENTMONKEY, 1);
    req.onsuccess = () => {
      try {
        transform(req.result);
      } catch (err) {
        // This should not happen, but did happen in Firefox.
        reject(err);
      }
    };
    req.onerror = reject;
    req.onupgradeneeded = () => {
      // No available upgradation
      reject();
    };
  }
  function transform(db) {
    const tx = db.transaction([SCRIPTS, S_REQUIRE, S_CACHE, VALUES]);
    const updates = {};
    let processing = 3;
    const done = () => {
      processing -= 1;
      if (!processing) resolve(storage.base.set(updates));
    };
    const getAll = (storeName, callback) => {
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => callback(req.result);
      req.onerror = reject;
    };
    getAll(SCRIPTS, (allScripts) => {
      const uriMap = {};
      allScripts.forEach((script) => {
        const { code, id, uri } = script;
        updates[storage[S_SCRIPT].toKey(id)] = transformScript(script);
        updates[storage[S_CODE].toKey(id)] = code;
        uriMap[uri] = id;
      });
      getAll(VALUES, (allValues) => {
        allValues.forEach(({ uri, [VALUES]: values }) => {
          const id = uriMap[uri];
          if (id) updates[storage[S_VALUE].toKey(id)] = values;
        });
        done();
      });
    });
    getAll(S_CACHE, (allCache) => {
      allCache.forEach(({ uri, data }) => {
        updates[storage[S_CACHE].toKey(uri)] = data;
      });
      done();
    });
    getAll(S_REQUIRE, (allRequire) => {
      allRequire.forEach(({ uri, code }) => {
        updates[storage[S_REQUIRE].toKey(uri)] = code;
      });
      done();
    });
  }
  function transformScript(script) {
    return {
      meta: parseMeta(script.code),
      custom: Object.assign({}, defaultCustom, script.custom),
      props: {
        id: script.id,
        uri: script.uri,
        position: script.position,
      },
      config: {
        enabled: script.enabled,
        shouldUpdate: script.update,
      },
    };
  }
})
// Ignore error
.catch(() => {});
