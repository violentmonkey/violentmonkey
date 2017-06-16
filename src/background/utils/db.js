import Promise from 'sync-promise-lite';
import { i18n, request, buffer2string, getFullUrl } from 'src/common';
import { getNameURI, getScriptInfo, isRemote, parseMeta, newScript } from './script';
import { testScript, testBlacklist } from './tester';

let db;

const position = {
  value: 0,
  set(v) {
    position.value = +v || 0;
  },
  get() {
    return position.value + 1;
  },
  update(v) {
    if (position.value < +v) position.set(v);
  },
};

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

function transformScript(script) {
  // XXX transform custom fields used in v2.6.1-
  if (script) {
    const { custom } = script;
    [
      ['origInclude', '_include'],
      ['origMatch', '_match'],
      ['origExclude', '_exclude'],
      ['origExcludeMatch', '_excludeMatch'],
    ].forEach(([key, oldKey]) => {
      if (typeof custom[key] === 'undefined') {
        custom[key] = custom[oldKey] !== false;
        delete custom[oldKey];
      }
    });
  }
  return script;
}

export function getScript(id, cTx) {
  const tx = cTx || db.transaction('scripts');
  const os = tx.objectStore('scripts');
  return new Promise(resolve => {
    os.get(id).onsuccess = e => {
      resolve(e.target.result);
    };
  })
  .then(transformScript);
}

export function queryScript(id, meta, cTx) {
  if (id) return getScript(id, cTx);
  return new Promise(resolve => {
    const uri = getNameURI({ meta });
    const tx = cTx || db.transaction('scripts');
    tx.objectStore('scripts').index('uri').get(uri).onsuccess = e => {
      resolve(e.target.result);
    };
  })
  .then(transformScript);
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
    const data = {
      uris: [],
    };
    const require = {};
    const cache = {};
    return (testBlacklist(url)
    ? Promise.resolve([])
    : getScriptsByIndex('position', null, tx, script => {
      if (!testScript(url, script)) return;
      data.uris.push(script.uri);
      script.meta.require.forEach(key => { require[key] = 1; });
      Object.keys(script.meta.resources).forEach(key => {
        cache[script.meta.resources[key]] = 1;
      });
      return script;
    }))
    .then(scripts => {
      data.scripts = scripts.filter(Boolean);
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
    const data = {};
    const cache = {};
    return getScriptsByIndex('position', null, tx, script => {
      const { icon } = script.meta;
      if (isRemote(icon)) cache[icon] = 1;
      return getScriptInfo(script);
    })
    .then(scripts => {
      data.scripts = scripts;
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
  if (!script.position) script.position = position.get();
  position.update(script.position);
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
    // DataURL cannot be loaded with `responseType=blob`
    // ref: https://bugs.chromium.org/p/chromium/issues/detail?id=412752
    promise = request(url, { responseType: 'arraybuffer' })
    .then(({ data: buffer }) => {
      const data = {
        buffer,
        blob(options) {
          return new Blob([buffer], options);
        },
        string() {
          return buffer2string(buffer);
        },
        base64() {
          return window.btoa(data.string());
        },
      };
      if (check) {
        return Promise.resolve(check(data)).then(() => data);
      }
      return data;
    })
    .then(({ base64 }) => saveCache(url, base64()))
    .then(() => { delete cacheRequests[url]; });
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
  const tx = db.transaction('scripts', 'readwrite');
  const os = tx.objectStore('scripts');
  return getScript(id, tx)
  .then(script => new Promise((resolve, reject) => {
    if (!script) return reject();
    Object.keys(data).forEach(key => {
      if (key in script) script[key] = data[key];
    });
    Object.assign(script.custom, custom);
    os.put(script).onsuccess = () => {
      resolve(getScriptInfo(script));
    };
  }));
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
  checkPosition();
  return loadScripts()
  .then(data => Promise.all([
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
    const data = {
      require: {},
      cache: {},
      values: {},
    };
    return getScriptsByIndex('position', null, tx, script => {
      const base = script.custom.lastInstallURL;
      script.meta.require.forEach(url => {
        const fullUrl = getFullUrl(url, base);
        data.require[fullUrl] = 1;
      });
      Object.keys(script.meta.resources).forEach(key => {
        const url = script.meta.resources[key];
        const fullUrl = getFullUrl(url, base);
        data.cache[fullUrl] = 1;
      });
      if (isRemote(script.meta.icon)) data.cache[script.meta.icon] = 1;
      data.values[script.uri] = 1;
    })
    .then(() => data);
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

export function getScriptsByIndex(index, options, cTx, mapEach) {
  const tx = cTx || db.transaction('scripts');
  return new Promise(resolve => {
    const os = tx.objectStore('scripts');
    const list = [];
    os.index(index).openCursor(options).onsuccess = e => {
      const { result } = e.target;
      if (result) {
        let { value } = result;
        value = transformScript(value);
        if (mapEach) value = mapEach(value);
        list.push(value);
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
  function fetchResources(base) {
    // @require
    meta.require.forEach(url => {
      const fullUrl = getFullUrl(url, base);
      const cache = data.require && data.require[fullUrl];
      if (cache) saveRequire(fullUrl, cache, tx);
      else fetchRequire(fullUrl);
    });
    // @resource
    Object.keys(meta.resources).forEach(k => {
      const url = meta.resources[k];
      const fullUrl = getFullUrl(url, base);
      const cache = data.resources && data.resources[fullUrl];
      if (cache) saveCache(fullUrl, cache);
      else fetchCache(fullUrl);
    });
    // @icon
    if (isRemote(meta.icon)) {
      fetchCache(
        getFullUrl(meta.icon, base),
        ({ blob: getBlob }) => new Promise((resolve, reject) => {
          const blob = getBlob({ type: 'image/png' });
          const url = URL.createObjectURL(blob);
          const image = new Image();
          const free = () => URL.revokeObjectURL(url);
          image.onload = () => {
            free();
            resolve();
          };
          image.onerror = () => {
            free();
            reject();
          };
          image.src = url;
        }),
      );
    }
  }
  return queryScript(data.id, meta, tx)
  .then(result => {
    let script;
    if (result) {
      if (data.isNew) throw i18n('msgNamespaceConflict');
      script = result;
    } else {
      script = newScript();
      script.position = position.get();
      res.cmd = 'AddScript';
      res.data.message = i18n('msgInstalled');
    }
    updateProps(script, data.more);
    Object.assign(script.custom, data.custom);
    script.meta = meta;
    script.code = data.code;
    script.uri = getNameURI(script);
    // use referer page as default homepage
    if (!meta.homepageURL && !script.custom.homepageURL && isRemote(data.from)) {
      script.custom.homepageURL = data.from;
    }
    if (isRemote(data.url)) script.custom.lastInstallURL = data.url;
    fetchResources(script.custom.lastInstallURL);
    script.custom.modified = data.modified || Date.now();
    return saveScript(script, tx);
  })
  .then(script => {
    Object.assign(res.data, getScriptInfo(script));
    return res;
  });
}

function initPosition() {
  const os = db.transaction('scripts').objectStore('scripts');
  return new Promise(resolve => {
    os.index('position').openCursor(null, 'prev').onsuccess = e => {
      const { result } = e.target;
      if (result) position.set(result.key);
      resolve();
    };
  });
}

export function checkPosition(start) {
  let offset = Math.max(1, start || 0);
  const updates = [];
  let changed;
  if (!position.checking) {
    const tx = db.transaction('scripts', 'readwrite');
    const os = tx.objectStore('scripts');
    position.checking = new Promise(resolve => {
      os.index('position').openCursor(start).onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          const { value } = cursor;
          if (value.position !== offset) updates.push({ id: value.id, position: offset });
          position.update(offset);
          offset += 1;
          cursor.continue();
        } else {
          resolve();
        }
      };
    })
    .then(() => {
      changed = updates.length;
      return update();
      function update() {
        const item = updates.shift();
        if (item) {
          return new Promise(resolve => {
            os.get(item.id).onsuccess = e => {
              const { result } = e.target;
              result.position = item.position;
              os.put(result).onsuccess = () => { resolve(); };
            };
          })
          .then(update);
        }
      }
    })
    .then(() => {
      browser.runtime.sendMessage({
        cmd: 'ScriptsUpdated',
      });
      position.checking = null;
    })
    .then(() => changed);
  }
  return position.checking;
}
