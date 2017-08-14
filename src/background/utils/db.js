import { i18n, request, buffer2string, getFullUrl, object } from 'src/common';
import { getNameURI, isRemote, parseMeta, newScript } from './script';
import { testScript, testBlacklist } from './tester';
import { register } from './init';

const patch = () => new Promise((resolve, reject) => {
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
        custom: script.custom,
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

function cacheOrFetch(handle) {
  const requests = {};
  return function cachedHandle(url, ...args) {
    let promise = requests[url];
    if (!promise) {
      promise = handle.call(this, url, ...args)
      .catch(() => {
        console.error(`Error fetching: ${url}`);
      })
      .then(() => {
        delete requests[url];
      });
      requests[url] = promise;
    }
    return promise;
  };
}
function ensureListArgs(handle) {
  return function handleList(data) {
    let items = Array.isArray(data) ? data : [data];
    items = items.filter(Boolean);
    if (!items.length) return Promise.resolve();
    return handle.call(this, items);
  };
}

const store = {};
const storage = {
  base: {
    prefix: '',
    getKey(id) {
      return `${this.prefix}${id}`;
    },
    getOne(id) {
      const key = this.getKey(id);
      return browser.storage.local.get(key).then(data => data[key]);
    },
    getMulti(ids) {
      return browser.storage.local.get(ids.map(id => this.getKey(id)))
      .then(data => {
        const result = {};
        ids.forEach(id => { result[id] = data[this.getKey(id)]; });
        return result;
      });
    },
    dump(id, value) {
      if (!id) return Promise.resolve();
      return browser.storage.local.set({
        [this.getKey(id)]: value,
      });
    },
    remove(id) {
      if (!id) return Promise.resolve();
      return browser.storage.local.remove(this.getKey(id));
    },
    removeMulti(ids) {
      return browser.storage.local.remove(ids.map(id => this.getKey(id)));
    },
  },
};
storage.script = Object.assign({}, storage.base, {
  prefix: 'scr:',
  dump: ensureListArgs(function dump(items) {
    const updates = {};
    items.forEach(item => {
      updates[this.getKey(item.props.id)] = item;
      store.scriptMap[item.props.id] = item;
    });
    return browser.storage.local.set(updates)
    .then(() => items);
  }),
});
storage.code = Object.assign({}, storage.base, {
  prefix: 'code:',
});
storage.value = Object.assign({}, storage.base, {
  prefix: 'val:',
});
storage.require = Object.assign({}, storage.base, {
  prefix: 'req:',
  fetch: cacheOrFetch(function fetch(uri) {
    return request(uri).then(({ data }) => this.dump(uri, data));
  }),
});
storage.cache = Object.assign({}, storage.base, {
  prefix: 'cac:',
  fetch: cacheOrFetch(function fetch(uri, check) {
    return request(uri, { responseType: 'arraybuffer' })
    .then(({ data: buffer }) => {
      const data = {
        buffer,
        blob: options => new Blob([buffer], options),
        string: () => buffer2string(buffer),
        base64: () => window.btoa(data.string()),
      };
      return (check ? Promise.resolve(check(data)) : Promise.resolve())
      .then(() => this.dump(uri, data.base64()));
    });
  }),
});

register(initialize());

function initialize() {
  return browser.storage.local.get('version')
  .then(({ version: lastVersion }) => {
    const { version } = browser.runtime.getManifest();
    return (lastVersion ? Promise.resolve() : patch())
    .then(() => {
      if (version !== lastVersion) return browser.storage.local.set({ version });
    });
  })
  .then(() => browser.storage.local.get())
  .then(data => {
    const scripts = [];
    const storeInfo = {
      id: 0,
      position: 0,
    };
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (key.startsWith('scr:')) {
        // {
        //   meta,
        //   custom,
        //   props: { id, position, uri },
        //   config: { enabled, shouldUpdate },
        // }
        scripts.push(value);
        storeInfo.id = Math.max(storeInfo.id, getInt(object.get(value, 'props.id')));
        storeInfo.position = Math.max(storeInfo.position, getInt(object.get(value, 'props.position')));
      }
    });
    scripts.sort((a, b) => {
      const [pos1, pos2] = [a, b].map(item => getInt(object.get(item, 'props.position')));
      return Math.sign(pos1 - pos2);
    });
    Object.assign(store, {
      scripts,
      storeInfo,
      scriptMap: scripts.reduce((map, item) => {
        map[item.props.id] = item;
        return map;
      }, {}),
    });
    if (process.env.DEBUG) {
      console.log('store:', store); // eslint-disable-line no-console
    }
    return normalizePosition();
  });
}

function getInt(val) {
  return +val || 0;
}

export function normalizePosition() {
  const updates = [];
  store.scripts.forEach((item, index) => {
    const position = index + 1;
    if (object.get(item, 'props.position') !== position) {
      object.set(item, 'props.position', position);
      updates.push(item);
    }
  });
  store.storeInfo.position = store.scripts.length;
  const { length } = updates;
  return length ? storage.script.dump(updates).then(() => length) : Promise.resolve();
}

export function getScript(where) {
  let script;
  if (where.id) {
    script = store.scriptMap[where.id];
  } else {
    const uri = where.uri || getNameURI({ meta: where.meta, id: '@@should-have-name' });
    const predicate = item => uri === object.get(item, 'props.uri');
    script = store.scripts.find(predicate);
  }
  return Promise.resolve(script);
}

export function getScripts() {
  return Promise.resolve(store.scripts);
}

export function getScriptByIds(ids) {
  return Promise.all(ids.map(id => getScript({ id })))
  .then(scripts => scripts.filter(Boolean));
}

export function getScriptCode(id) {
  return storage.code.getOne(id);
}

export function setValues(where, values) {
  return (where.id
    ? Promise.resolve(where.id)
    : getScript(where).then(script => object.get(script, 'props.id')))
  .then(id => {
    if (id) storage.value.dump(id, values).then(() => ({ id, values }));
  });
}

/**
 * @desc Get scripts to be injected to page with specific URL.
 */
export function getScriptsByURL(url) {
  const scripts = testBlacklist(url)
    ? []
    : store.scripts.filter(script => !script.config.removed && testScript(url, script));
  const reqKeys = {};
  const cacheKeys = {};
  scripts.forEach(script => {
    if (object.get(script, 'config.enabled')) {
      script.meta.require.forEach(key => {
        reqKeys[key] = 1;
      });
      Object.keys(script.meta.resources).forEach(key => {
        cacheKeys[script.meta.resources[key]] = 1;
      });
    }
  });
  const enabledScriptIds = scripts
  .filter(script => script.config.enabled)
  .map(script => script.props.id);
  return Promise.all([
    storage.require.getMulti(Object.keys(reqKeys)),
    storage.cache.getMulti(Object.keys(cacheKeys)),
    storage.value.getMulti(enabledScriptIds),
    storage.code.getMulti(enabledScriptIds),
  ])
  .then(([require, cache, values, code]) => ({
    scripts,
    require,
    cache,
    values,
    code,
  }));
}

/**
 * @desc Get data for dashboard.
 */
export function getData() {
  const cacheKeys = {};
  const { scripts } = store;
  scripts.forEach(script => {
    const icon = object.get(script, 'meta.icon');
    if (isRemote(icon)) cacheKeys[icon] = 1;
  });
  return storage.cache.getMulti(Object.keys(cacheKeys))
  .then(cache => {
    Object.keys(cache).forEach(key => {
      cache[key] = `data:image/png;base64,${cache[key]}`;
    });
    return cache;
  })
  .then(cache => ({ scripts, cache }));
}

export function checkRemove() {
  const toRemove = store.scripts.filter(script => script.config.removed);
  if (toRemove.length) {
    store.scripts = store.scripts.filter(script => !script.config.removed);
    storage.script.removeMulti(toRemove);
    storage.code.removeMulti(toRemove);
  }
  return Promise.resolve(toRemove.length);
}

export function removeScript(id) {
  const i = store.scripts.findIndex(item => id === object.get(item, 'props.id'));
  if (i >= 0) {
    store.scripts.splice(i, 1);
    storage.script.remove(id);
    storage.code.remove(id);
  }
  return browser.runtime.sendMessage({
    cmd: 'RemoveScript',
    data: id,
  });
}

export function moveScript(id, offset) {
  const index = store.scripts.findIndex(item => id === object.get(item, 'props.id'));
  const step = offset > 0 ? 1 : -1;
  const indexStart = index;
  const indexEnd = index + offset;
  const offsetI = Math.min(indexStart, indexEnd);
  const offsetJ = Math.max(indexStart, indexEnd);
  const updated = store.scripts.slice(offsetI, offsetJ + 1);
  if (step > 0) {
    updated.push(updated.shift());
  } else {
    updated.unshift(updated.pop());
  }
  store.scripts = [
    ...store.scripts.slice(0, offsetI),
    ...updated,
    ...store.scripts.slice(offsetJ + 1),
  ];
  return normalizePosition();
}

function saveScript(script, code) {
  const config = script.config || {};
  config.enabled = getInt(config.enabled);
  config.shouldUpdate = getInt(config.shouldUpdate);
  const props = script.props || {};
  let oldScript;
  if (!props.id) {
    store.storeInfo.id += 1;
    props.id = store.storeInfo.id;
  } else {
    oldScript = store.scriptMap[props.id];
  }
  props.uri = getNameURI(script);
  // Do not allow script with same name and namespace
  if (store.scripts.some(item => {
    const itemProps = item.props || {};
    return props.id !== itemProps.id && props.uri === itemProps.uri;
  })) {
    throw i18n('msgNamespaceConflict');
  }
  if (oldScript) {
    script.config = Object.assign({}, oldScript.config, config);
    script.props = Object.assign({}, oldScript.props, props);
    const index = store.scripts.indexOf(oldScript);
    store.scripts[index] = script;
  } else {
    store.storeInfo.position += 1;
    props.position = store.storeInfo.position;
    script.config = config;
    script.props = props;
    store.scripts.push(script);
  }
  return Promise.all([
    storage.script.dump(script),
    storage.code.dump(props.id, code),
  ]);
}

export function updateScriptInfo(id, data) {
  const script = store.scriptMap[id];
  if (!script) return Promise.reject();
  script.config = Object.assign({}, script.config, data.config);
  script.custom = Object.assign({}, script.custom, data.custom);
  return storage.script.dump(script);
}

export function getExportData(ids, withValues) {
  const availableIds = ids.filter(id => {
    const script = store.scriptMap[id];
    return script && !script.config.removed;
  });
  return Promise.all([
    Promise.all(availableIds.map(id => getScript({ id }))),
    storage.code.getMulti(availableIds),
  ])
  .then(([scripts, codeMap]) => {
    const data = {};
    data.items = scripts.map(script => ({ script, code: codeMap[script.props.id] }));
    if (withValues) {
      return storage.value.getMulti(ids)
      .then(values => {
        data.values = values;
        return data;
      });
    }
    return data;
  });
}

export function parseScript(data) {
  const { id, code, message, isNew, config, custom } = data;
  const meta = parseMeta(code);
  if (!meta.name) throw i18n('msgInvalidScript');
  const result = {
    cmd: 'UpdateScript',
    data: {
      update: {
        message: message == null ? i18n('msgUpdated') : message || '',
      },
    },
  };
  return getScript({ id, meta })
  .then(oldScript => {
    let script;
    if (oldScript) {
      if (isNew) throw i18n('msgNamespaceConflict');
      script = Object.assign({}, oldScript);
    } else {
      ({ script } = newScript());
      result.cmd = 'AddScript';
      result.data.update.message = i18n('msgInstalled');
    }
    script.config = Object.assign({}, script.config, config);
    script.custom = Object.assign({}, script.custom, custom);
    script.meta = meta;
    if (!meta.homepageURL && !script.custom.homepageURL && isRemote(data.from)) {
      script.custom.homepageURL = data.from;
    }
    if (isRemote(data.url)) script.custom.lastInstallURL = data.url;
    object.set(script, 'props.lastModified', data.modified || Date.now());
    const position = +data.position;
    if (position) object.set(script, 'props.position', position);
    return saveScript(script, code).then(() => script);
  })
  .then(script => {
    fetchScriptResources(script, data);
    Object.assign(result.data.update, script);
    result.data.where = { id: script.props.id };
    return result;
  });
}

function fetchScriptResources(script, cache) {
  const base = object.get(script, 'custom.lastInstallURL');
  const meta = script.meta;
  // @require
  meta.require.forEach(url => {
    const fullUrl = getFullUrl(url, base);
    const cached = object.get(cache, ['require', fullUrl]);
    if (cached) {
      storage.require.dump(fullUrl, cached);
    } else {
      storage.require.fetch(fullUrl);
    }
  });
  // @resource
  Object.keys(meta.resources).forEach(key => {
    const url = meta.resources[key];
    const fullUrl = getFullUrl(url, base);
    const cached = object.get(cache, ['resources', fullUrl]);
    if (cached) {
      storage.cache.dump(fullUrl, cached);
    } else {
      storage.cache.fetch(fullUrl);
    }
  });
  // @icon
  if (isRemote(meta.icon)) {
    const fullUrl = getFullUrl(meta.icon, base);
    storage.cache.fetch(fullUrl, ({ blob: getBlob }) => new Promise((resolve, reject) => {
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
    }));
  }
}

export function vacuum() {
  const valueKeys = {};
  const cacheKeys = {};
  const requireKeys = {};
  const codeKeys = {};
  const mappings = [
    [storage.value, valueKeys],
    [storage.cache, cacheKeys],
    [storage.require, requireKeys],
    [storage.code, codeKeys],
  ];
  browser.storage.get().then(data => {
    Object.keys(data).forEach(key => {
      mappings.some(([substore, map]) => {
        const { prefix } = substore;
        if (key.startsWith(prefix)) {
          // -1 for untouched, 1 for touched, 2 for missing
          map[key.slice(prefix.length)] = -1;
          return true;
        }
      });
    });
  });
  const touch = (obj, key) => {
    if (obj[key] < 0) obj[key] = 1;
    else if (!obj[key]) obj[key] = 2;
  };
  store.scripts.forEach(script => {
    const { id } = script.props;
    touch(codeKeys, id);
    touch(valueKeys, id);
    const base = script.custom.lastInstallURL;
    script.meta.require.forEach(url => {
      const fullUrl = getFullUrl(url, base);
      touch(requireKeys, fullUrl);
    });
    Object.keys(script.meta.resources).forEach(key => {
      const url = script.meta.resources[key];
      const fullUrl = getFullUrl(url, base);
      touch(cacheKeys, fullUrl);
    });
    const { icon } = script.meta;
    if (isRemote(icon)) {
      const fullUrl = getFullUrl(icon, base);
      touch(cacheKeys, fullUrl);
    }
  });
  mappings.forEach(([substore, map]) => {
    Object.keys(map).forEach(key => {
      const value = map[key];
      if (value < 0) {
        // redundant value
        substore.remove(key);
      } else if (value === 2 && substore.fetch) {
        // missing resource
        substore.fetch(key);
      }
    });
  });
}
