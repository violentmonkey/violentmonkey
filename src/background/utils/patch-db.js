import { parseMeta } from './script';
import storage from '#/common/storage';

export default () => new Promise((resolve, reject) => {
  console.info('Upgrade database...');
  init();
  function init() {
    const req = indexedDB.open('Violentmonkey', 1);
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
    const tx = db.transaction(['scripts', 'require', 'cache', 'values']);
    const updates = {};
    let processing = 3;
    const done = () => {
      processing -= 1;
      if (!processing) resolve(browser.storage.local.set(updates));
    };
    const getAll = (storeName, callback) => {
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => callback(req.result);
      req.onerror = reject;
    };
    getAll('scripts', (allScripts) => {
      const uriMap = {};
      allScripts.forEach((script) => {
        const { code, id, uri } = script;
        updates[`${storage.script.prefix}${id}`] = transformScript(script);
        updates[`${storage.code.prefix}${id}`] = code;
        uriMap[uri] = id;
      });
      getAll('values', (allValues) => {
        allValues.forEach(({ uri, values }) => {
          const id = uriMap[uri];
          if (id) updates[`${storage.value.prefix}${id}`] = values;
        });
        done();
      });
    });
    getAll('cache', (allCache) => {
      allCache.forEach(({ uri, data }) => {
        updates[`${storage.cache.prefix}${uri}`] = data;
      });
      done();
    });
    getAll('require', (allRequire) => {
      allRequire.forEach(({ uri, code }) => {
        updates[`${storage.require.prefix}${uri}`] = code;
      });
      done();
    });
  }
  function transformScript(script) {
    return {
      meta: parseMeta(script.code),
      custom: Object.assign({
        origInclude: true,
        origExclude: true,
        origMatch: true,
        origExcludeMatch: true,
      }, script.custom),
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
