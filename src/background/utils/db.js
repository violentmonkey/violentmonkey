import Promise from 'sync-promise-lite';
import { i18n, request } from 'src/common';
import { getNameURI, getScriptInfo, isRemote, parseMeta, newScript } from './script';
import { testScript, testBlacklist } from './tester';

let db;
let position;

export const initialized = openDatabase().then(initPosition);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('Violentmonkey', 1);
    req.onsuccess = () => {
      db = req.result;
      resolve();
    };
    req.onerror = e => {
      const { error } = e.target;
      console.error(`IndexedDB error: ${error.message}`);
      reject(error);
    };
    req.onupgradeneeded = e => {
      const _db = e.currentTarget.result;
      // scripts: id uri custom meta enabled update code position
      const os = _db.createObjectStore('scripts', {
        keyPath: 'id',
        autoIncrement: true,
      });
      os.createIndex('uri', 'uri', { unique: true });
      os.createIndex('update', 'update', { unique: false });
      // position should be unique at last
      os.createIndex('position', 'position', { unique: false });
      // require: uri code
      _db.createObjectStore('require', { keyPath: 'uri' });
      // cache: uri data
      _db.createObjectStore('cache', { keyPath: 'uri' });
      // values: uri values
      _db.createObjectStore('values', { keyPath: 'uri' });
    };
  });
}

function initPosition() {
  position = 0;
  const os = db.transaction('scripts', 'readwrite').objectStore('scripts');
  return new Promise(resolve => {
    os.index('position').openCursor(null, 'prev').onsuccess = e => {
      const { result } = e.target;
      if (result) position = result.key;
      resolve();
    };
  });
}

export function getScript(id, cTx) {
  const tx = cTx || db.transaction('scripts');
  const os = tx.objectStore('scripts');
  return new Promise(resolve => {
    os.get(id).onsuccess = e => {
      resolve(e.target.result);
    };
  });
}

export function queryScript(id, meta, cTx) {
  if (id) return getScript(id, cTx);
  return new Promise(resolve => {
    const uri = getNameURI({ meta });
    const tx = cTx || db.transaction('scripts');
    tx.objectStore('scripts').index('uri').get(uri).onsuccess = e => {
      resolve(e.target.result);
    };
  });
}

export function getScriptData(id) {
  return getScript(id).then(script => {
    if (!script) return Promise.reject();
    const data = getScriptInfo(script);
    data.code = script.code;
    return data;
  });
}

export function getScriptInfos(ids) {
  const tx = db.transaction('scripts');
  return Promise.all(ids.map(id => getScript(id, tx)))
  .then(scripts => scripts.filter(Boolean).map(getScriptInfo));
}

export function getValues(uris, cTx) {
  const tx = cTx || db.transaction('values');
  const os = tx.objectStore('values');
  return Promise.all(uris.map(uri => new Promise(resolve => {
    os.get(uri).onsuccess = e => {
      resolve(e.target.result);
    };
  })))
  .then(data => data.reduce((result, value, i) => {
    if (value) result[uris[i]] = value.values;
    return result;
  }, {}));
}

export function getScriptsByURL(url) {
  const tx = db.transaction(['scripts', 'require', 'values', 'cache']);
  return loadScripts()
  .then(data => Promise.all([
    loadRequires(data.require),
    getValues(data.uris, tx),
    getCacheB64(data.cache, tx),
  ]).then(res => ({
    scripts: data.scripts,
    require: res[0],
    values: res[1],
    cache: res[2],
  })));

  function loadScripts() {
    return getScriptsByIndex('position', null, tx)
    .then(scripts => {
      const data = {
        uris: [],
      };
      const require = {};
      const cache = {};
      data.scripts = scripts.filter(script => {
        if (testBlacklist(url) || !testScript(url, script)) return;
        data.uris.push(script.uri);
        script.meta.require.forEach(key => { require[key] = 1; });
        Object.keys(script.meta.resources).forEach(key => {
          cache[script.meta.resources[key]] = 1;
        });
        return true;
      });
      data.require = Object.keys(require);
      data.cache = Object.keys(cache);
      return data;
    });
  }
  function loadRequires(uris) {
    const os = tx.objectStore('require');
    return Promise.all(uris.map(uri => new Promise(resolve => {
      os.get(uri).onsuccess = e => {
        resolve(e.target.result);
      };
    })))
    .then(data => data.reduce((result, value, i) => {
      if (value) result[uris[i]] = value.code;
      return result;
    }, {}));
  }
}

export function getData() {
  const tx = db.transaction(['scripts', 'cache']);
  return loadScripts()
  .then(data => loadCache(data.cache).then(cache => ({
    cache,
    scripts: data.scripts,
  })));

  function loadScripts() {
    return getScriptsByIndex('position', null, tx)
    .then(scripts => {
      const data = {};
      const cache = {};
      data.scripts = scripts.map(script => {
        const { icon } = script.meta;
        if (isRemote(icon)) cache[icon] = 1;
        return getScriptInfo(script);
      });
      data.cache = Object.keys(cache);
      return data;
    });
  }
  function loadCache(uris) {
    return getCacheB64(uris, tx)
    .then(cache => {
      Object.keys(cache).forEach(key => {
        cache[key] = `data:image/png;base64,${cache[key]}`;
      });
      return cache;
    });
  }
}

export function removeScript(id) {
  const tx = db.transaction('scripts', 'readwrite');
  return new Promise(resolve => {
    const os = tx.objectStore('scripts');
    os.delete(id).onsuccess = () => { resolve(); };
  })
  .then(() => {
    browser.runtime.sendMessage({
      cmd: 'RemoveScript',
      data: id,
    });
  });
}

export function moveScript(id, offset) {
  const tx = db.transaction('scripts', 'readwrite');
  const os = tx.objectStore('scripts');
  return getScript(id, tx)
  .then(script => {
    let pos = script.position;
    let range;
    let order;
    let number = offset;
    if (offset < 0) {
      range = IDBKeyRange.upperBound(pos, true);
      order = 'prev';
      number = -number;
    } else {
      range = IDBKeyRange.lowerBound(pos, true);
      order = 'next';
    }
    return new Promise(resolve => {
      os.index('position').openCursor(range, order).onsuccess = e => {
        const { result } = e.target;
        if (result) {
          number -= 1;
          const { value } = result;
          value.position = pos;
          pos = result.key;
          result.update(value);
          if (number) result.continue();
          else {
            script.position = pos;
            os.put(script).onsuccess = () => { resolve(); };
          }
        }
      };
    });
  });
}

function getCacheB64(urls, cTx) {
  const tx = cTx || db.transaction('cache');
  const os = tx.objectStore('cache');
  return Promise.all(urls.map(url => new Promise(resolve => {
    os.get(url).onsuccess = e => {
      resolve(e.target.result);
    };
  })))
  .then(data => data.reduce((map, value, i) => {
    if (value) map[urls[i]] = value.data;
    return map;
  }, {}));
}

function saveCache(uri, data, cTx) {
  const tx = cTx || db.transaction('cache', 'readwrite');
  const os = tx.objectStore('cache');
  return new Promise(resolve => {
    os.put({ uri, data }).onsuccess = () => { resolve(); };
  });
}

function saveRequire(uri, code, cTx) {
  const tx = cTx || db.transaction('require', 'readwrite');
  const os = tx.objectStore('require');
  return new Promise(resolve => {
    os.put({ uri, code }).onsuccess = () => { resolve(); };
  });
}

export function saveScript(script, cTx) {
  script.enabled = script.enabled ? 1 : 0;
  script.update = script.update ? 1 : 0;
  if (!script.position) {
    position += 1;
    script.position = position;
  }
  const tx = cTx || db.transaction('scripts', 'readwrite');
  const os = tx.objectStore('scripts');
  return new Promise((resolve, reject) => {
    const res = os.put(script);
    res.onsuccess = e => {
      script.id = e.target.result;
      resolve(script);
    };
    res.onerror = () => {
      reject(i18n('msgNamespaceConflict'));
    };
  });
}

const cacheRequests = {};
function fetchCache(url, check) {
  let promise = cacheRequests[url];
  if (!promise) {
    promise = request(url, { responseType: 'blob' })
    .then(({ data }) => Promise.resolve(check && check(data)).then(() => data))
    .then(data => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        saveCache(url, window.btoa(reader.result)).then(() => {
          delete cacheRequests[url];
          resolve();
        });
      };
      reader.onerror = e => { reject(e); };
      reader.readAsBinaryString(data);
    }));
    cacheRequests[url] = promise;
  }
  return promise;
}

const requireRequests = {};
function fetchRequire(url) {
  let promise = requireRequests[url];
  if (!promise) {
    promise = request(url)
    .then(({ data }) => saveRequire(url, data))
    .catch(() => { console.error(`Error fetching required script: ${url}`); })
    .then(() => { delete requireRequests[url]; });
    requireRequests[url] = promise;
  }
  return promise;
}

export function setValue(uri, values) {
  const os = db.transaction('values', 'readwrite').objectStore('values');
  return new Promise(resolve => {
    os.put({ uri, values }).onsuccess = () => { resolve(); };
  });
}

export function updateScriptInfo(id, data, custom) {
  const os = db.transaction('scripts', 'readwrite').objectStore('scripts');
  return new Promise((resolve, reject) => {
    os.get(id).onsuccess = e => {
      const { result: script } = e.target;
      if (!script) return reject();
      Object.keys(data).forEach(key => {
        if (key in script) script[key] = data[key];
      });
      Object.assign(script.custom, custom);
      os.put(script).onsuccess = () => {
        resolve(getScriptInfo(script));
      };
    };
  });
}

export function getExportData(ids, withValues) {
  const tx = db.transaction(['scripts', 'values']);
  return loadScripts()
  .then(scripts => {
    const res = { scripts };
    if (withValues) {
      return getValues(scripts.map(script => script.uri), tx)
      .then(values => {
        res.values = values;
        return res;
      });
    }
    return res;
  });
  function loadScripts() {
    const os = tx.objectStore('scripts');
    return Promise.all(ids.map(id => new Promise(resolve => {
      os.get(id).onsuccess = e => {
        resolve(e.target.result);
      };
    })))
    .then(data => data.filter(Boolean));
  }
}

export function vacuum() {
  const tx = db.transaction(['scripts', 'require', 'cache', 'values'], 'readwrite');
  return loadScripts()
  .then(data => Promise.all([
    vacuumPosition(data.ids),
    vacuumCache('require', data.require),
    vacuumCache('cache', data.cache),
    vacuumCache('values', data.values),
  ]).then(() => ({
    require: data.require,
    cache: data.cache,
  })))
  .then(data => Promise.all([
    Object.keys(data.require).map(k => data.require[k] === 1 && fetchRequire(k)),
    Object.keys(data.cache).map(k => data.cache[k] === 1 && fetchCache(k)),
  ]));

  function loadScripts() {
    return getScriptsByIndex('position', null, tx)
    .then(scripts => {
      const data = {
        require: {},
        cache: {},
        values: {},
      };
      data.ids = scripts.map(script => {
        script.meta.require.forEach(uri => { data.require[uri] = 1; });
        Object.keys(script.meta.resources).forEach(key => {
          data.cache[script.meta.resources[key]] = 1;
        });
        if (isRemote(script.meta.icon)) data.cache[script.meta.icon] = 1;
        data.values[script.uri] = 1;
        return script.id;
      });
      return data;
    });
  }
  function vacuumPosition(ids) {
    const os = tx.objectStore('scripts');
    return ids.reduce((res, id, i) => res.then(() => new Promise(resolve => {
      os.get(id).onsuccess = e => {
        const { result } = e.target;
        result.position = i + 1;
        os.put(result).onsuccess = () => resolve();
      };
    })), Promise.resolve());
  }
  function vacuumCache(dbName, dict) {
    const os = tx.objectStore(dbName);
    const deleteCache = uri => new Promise(resolve => {
      if (!dict[uri]) {
        os.delete(uri).onsuccess = () => { resolve(); };
      } else {
        dict[uri] += 1;
        resolve();
      }
    });
    return new Promise(resolve => {
      os.openCursor().onsuccess = e => {
        const { result } = e.target;
        if (result) {
          const { value } = result;
          deleteCache(value.uri).then(() => result.continue());
        } else resolve();
      };
    });
  }
}

export function getScriptsByIndex(index, value, cTx) {
  const tx = cTx || db.transaction('scripts');
  return new Promise(resolve => {
    const os = tx.objectStore('scripts');
    const list = [];
    os.index(index).openCursor(value).onsuccess = e => {
      const { result } = e.target;
      if (result) {
        list.push(result.value);
        result.continue();
      } else resolve(list);
    };
  });
}

function updateProps(target, source) {
  if (source) {
    Object.keys(source).forEach(key => {
      if (key in target) target[key] = source[key];
    });
  }
  return target;
}

export function parseScript(data) {
  const meta = parseMeta(data.code);
  if (!meta.name) return Promise.reject(i18n('msgInvalidScript'));
  const res = {
    cmd: 'UpdateScript',
    data: {
      message: data.message == null ? i18n('msgUpdated') : data.message || '',
    },
  };
  const tx = db.transaction(['scripts', 'require'], 'readwrite');
  // @require
  meta.require.forEach(url => {
    const cache = data.require && data.require[url];
    if (cache) saveRequire(url, cache, tx);
    else fetchRequire(url);
  });
  // @resource
  Object.keys(meta.resources).forEach(k => {
    const url = meta.resources[k];
    const cache = data.resources && data.resources[url];
    if (cache) saveCache(url, cache);
    else fetchCache(url);
  });
  // @icon
  if (isRemote(meta.icon)) {
    fetchCache(meta.icon, blob => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const free = () => URL.revokeObjectURL(url);
      image.onload = () => {
        free();
        resolve(blob);
      };
      image.onerror = () => {
        free();
        reject();
      };
      image.src = url;
    }));
  }
  return queryScript(data.id, meta, tx)
  .then(result => {
    let script;
    if (result) {
      if (data.isNew) throw i18n('msgNamespaceConflict');
      script = result;
    } else {
      script = newScript();
      res.cmd = 'AddScript';
      res.data.message = i18n('msgInstalled');
    }
    updateProps(script, data.more);
    updateProps(script.custom, data.custom);
    script.meta = meta;
    script.code = data.code;
    script.uri = getNameURI(script);
    // use referer page as default homepage
    if (!meta.homepageURL && !script.custom.homepageURL && isRemote(data.from)) {
      script.custom.homepageURL = data.from;
    }
    if (isRemote(data.url)) script.custom.lastInstallURL = data.url;
    script.custom.modified = data.modified || Date.now();
    return saveScript(script, tx);
  })
  .then(script => {
    Object.assign(res.data, getScriptInfo(script));
    return res;
  });
}
