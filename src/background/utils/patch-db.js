import { parseMeta } from './script';

export default () => new Promise((resolve, reject) => {
  console.info('Upgrade database...');
  init();
  function init() {
    const req = indexedDB.open('Violentmonkey', 1);
    req.onsuccess = () => {
      transform(req.result);
    };
    req.onerror = reject;
    req.onupgradeneeded = () => {
      // No available upgradation
      throw reject();
    };
  }
  function transform(db) {
    const tx = db.transaction(['scripts', 'require', 'cache', 'values']);
    const updates = {};
    let processing = 3;
    const onCallback = () => {
      processing -= 1;
      if (!processing) resolve(browser.storage.local.set(updates));
    };
    getAllScripts(tx, items => {
      const uriMap = {};
      items.forEach(({ script, code }) => {
        updates[`scr:${script.props.id}`] = script;
        updates[`code:${script.props.id}`] = code;
        uriMap[script.props.uri] = script.props.id;
      });
      getAllValues(tx, data => {
        data.forEach(({ id, values }) => {
          updates[`val:${id}`] = values;
        });
        onCallback();
      }, uriMap);
    });
    getAllCache(tx, cache => {
      cache.forEach(({ uri, data }) => {
        updates[`cac:${uri}`] = data;
      });
      onCallback();
    });
    getAllRequire(tx, data => {
      data.forEach(({ uri, code }) => {
        updates[`req:${uri}`] = code;
      });
      onCallback();
    });
  }
  function getAllScripts(tx, callback) {
    const os = tx.objectStore('scripts');
    const list = [];
    const req = os.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const { value } = cursor;
        list.push(transformScript(value));
        cursor.continue();
      } else {
        callback(list);
      }
    };
    req.onerror = reject;
  }
  function getAllCache(tx, callback) {
    const os = tx.objectStore('cache');
    const list = [];
    const req = os.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const { value: { uri, data } } = cursor;
        list.push({ uri, data });
        cursor.continue();
      } else {
        callback(list);
      }
    };
    req.onerror = reject;
  }
  function getAllRequire(tx, callback) {
    const os = tx.objectStore('require');
    const list = [];
    const req = os.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const { value: { uri, code } } = cursor;
        list.push({ uri, code });
        cursor.continue();
      } else {
        callback(list);
      }
    };
    req.onerror = reject;
  }
  function getAllValues(tx, callback, uriMap) {
    const os = tx.objectStore('values');
    const list = [];
    const req = os.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const { value: { uri, values } } = cursor;
        const id = uriMap[uri];
        if (id) list.push({ id, values });
        cursor.continue();
      } else {
        callback(list);
      }
    };
    req.onerror = reject;
  }
  function transformScript(script) {
    const item = {
      script: {
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
      },
      code: script.code,
    };
    return item;
  }
})
// Ignore error
.catch(() => {});
