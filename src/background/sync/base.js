import { debounce, normalizeKeys, request, noop } from 'src/common';
import getEventEmitter from '../utils/events';
import { getOption, setOption, hookOptions } from '../utils/options';
import { getScriptsByIndex, parseScript, removeScript, checkPosition } from '../utils/db';

const serviceNames = [];
const services = {};
const autoSync = debounce(sync, 60 * 60 * 1000);
let working = Promise.resolve();
const syncConfig = initConfig();

export function getFilename(uri) {
  return `vm-${encodeURIComponent(uri)}`;
}
export function isScriptFile(name) {
  return /^vm-/.test(name);
}
export function getURI(name) {
  return decodeURIComponent(name.slice(3));
}

function initConfig() {
  function get(key, def) {
    const keys = normalizeKeys(key);
    keys.unshift('sync');
    return getOption(keys, def);
  }
  function set(key, value) {
    const keys = normalizeKeys(key);
    keys.unshift('sync');
    setOption(keys, value);
  }
  function init() {
    let config = getOption('sync');
    if (!config || !config.services) {
      config = {
        services: {},
      };

      // XXX Migrate from old data
      ['dropbox', 'onedrive']
      .forEach(key => {
        config.services[key] = getOption(key);
      });

      set([], config);
    }
  }
  init();
  return { get, set };
}
function serviceConfig(name) {
  function getKeys(key) {
    const keys = normalizeKeys(key);
    keys.unshift('services', name);
    return keys;
  }
  function get(key, def) {
    return syncConfig.get(getKeys(key), def);
  }
  function set(key, val) {
    if (typeof key === 'object') {
      const data = key;
      Object.keys(data).forEach(k => {
        syncConfig.set(getKeys(k), data[k]);
      });
    } else {
      syncConfig.set(getKeys(key), val);
    }
  }
  function clear() {
    syncConfig.set(getKeys(), {});
  }
  return { get, set, clear };
}
function serviceState(validStates, initialState, onChange) {
  let state = initialState || validStates[0];
  function get() {
    return state;
  }
  function set(newState) {
    if (validStates.includes(newState)) {
      state = newState;
      if (onChange) onChange();
    } else {
      console.warn('Invalid state:', newState);
    }
    return get();
  }
  function is(states) {
    const stateArray = Array.isArray(states) ? states : [states];
    return stateArray.includes(state);
  }
  return { get, set, is };
}
export function getStates() {
  return serviceNames.map(name => {
    const service = services[name];
    return {
      name: service.name,
      displayName: service.displayName,
      authState: service.authState.get(),
      syncState: service.syncState.get(),
      lastSync: service.config.get('meta', {}).lastSync,
      progress: service.progress,
    };
  });
}

function serviceFactory(base) {
  const Service = function constructor(...args) {
    if (!(this instanceof Service)) return new Service(...args);
    this.initialize(...args);
  };
  Service.prototype = base;
  Service.extend = extendService;
  return Service;
}
function extendService(options) {
  return serviceFactory(Object.assign(Object.create(this.prototype), options));
}

const onStateChange = debounce(() => {
  browser.runtime.sendMessage({
    cmd: 'UpdateSync',
    data: getStates(),
  });
});

export const BaseService = serviceFactory({
  name: 'base',
  displayName: 'BaseService',
  delayTime: 1000,
  urlPrefix: '',
  metaFile: 'Violentmonkey',
  initialize(name) {
    if (name) this.name = name;
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.config = serviceConfig(this.name);
    this.authState = serviceState([
      'idle',
      'initializing',
      'authorizing',  // in case some services require asynchronous requests to get access_tokens
      'authorized',
      'unauthorized',
      'error',
    ], null, onStateChange);
    this.syncState = serviceState([
      'idle',
      'ready',
      'syncing',
      'error',
    ], null, onStateChange);
    // this.initToken();
    this.lastFetch = Promise.resolve();
    this.startSync = this.syncFactory();
    const events = getEventEmitter();
    ['on', 'off', 'fire']
    .forEach(key => {
      this[key] = (...args) => { events[key](...args); };
    });
  },
  log(...args) {
    console.log(...args);  // eslint-disable-line no-console
  },
  syncFactory() {
    let promise;
    let debouncedResolve;
    const shouldSync = () => this.authState.is('authorized') && getCurrent() === this.name;
    const getReady = () => {
      if (!shouldSync()) return Promise.resolve();
      this.log('Ready to sync:', this.displayName);
      this.syncState.set('ready');
      working = working.then(() => new Promise(resolve => {
        debouncedResolve = debounce(resolve, 10 * 1000);
        debouncedResolve();
      }))
      .then(() => {
        if (shouldSync()) return this.sync();
        this.syncState.set('idle');
      })
      .catch(err => { console.error(err); })
      .then(() => {
        promise = null;
        debouncedResolve = null;
      });
      promise = working;
    };
    function startSync() {
      if (!promise) getReady();
      if (debouncedResolve) debouncedResolve();
      return promise;
    }
    return startSync;
  },
  prepareHeaders() {
    this.headers = {};
  },
  prepare() {
    this.authState.set('initializing');
    return (this.initToken() ? Promise.resolve(this.user()) : Promise.reject({
      type: 'unauthorized',
    }))
    .then(() => {
      this.authState.set('authorized');
    }, err => {
      if (err && err.type === 'unauthorized') {
        // _this.config.clear();
        this.authState.set('unauthorized');
      } else {
        console.error(err);
        this.authState.set('error');
      }
      this.syncState.set('idle');
      throw err;
    });
  },
  checkSync() {
    return this.prepare()
    .then(() => this.startSync());
  },
  user: noop,
  getMeta() {
    return this.get(this.metaFile)
    .then(data => JSON.parse(data));
  },
  initToken() {
    this.prepareHeaders();
    const token = this.config.get('token');
    this.headers.Authorization = token ? `Bearer ${token}` : null;
    return !!token;
  },
  loadData(options) {
    const { progress } = this;
    let lastFetch;
    if (options.delay == null) {
      lastFetch = Promise.resolve(Date.now());
    } else {
      lastFetch = this.lastFetch
      .then(ts => new Promise(resolve => {
        let delay = options.delay;
        if (!isNaN(delay)) delay = this.delayTime;
        const delta = delay - (Date.now() - ts);
        if (delta > 0) {
          setTimeout(resolve, delta);
        } else {
          resolve();
        }
      }))
      .then(() => Date.now());
    }
    this.lastFetch = lastFetch;
    progress.total += 1;
    onStateChange();
    return lastFetch.then(() => {
      let { prefix } = options;
      if (prefix == null) prefix = this.urlPrefix;
      const headers = Object.assign({}, this.headers, options.headers);
      let { url } = options;
      if (url.startsWith('/')) url = prefix + url;
      return request(url, {
        headers,
        method: options.method,
        body: options.body,
        responseType: options.responseType,
      });
    })
    .then(({ data }) => ({ data }), error => ({ error }))
    .then(({ data, error }) => {
      progress.finished += 1;
      onStateChange();
      if (error) return Promise.reject(error);
      return data;
    });
  },
  sync() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.syncState.set('syncing');
    // Avoid simultaneous requests
    return this.getMeta()
    .then(remoteMeta => Promise.all([
      remoteMeta,
      this.list(),
      getScriptsByIndex('position'),
    ]))
    .then(([remoteMeta, remoteData, localData]) => {
      const remoteMetaInfo = remoteMeta.info || {};
      let remoteChanged = !remoteMeta.timestamp
        || Object.keys(remoteMetaInfo).length !== remoteData.length;
      const now = Date.now();
      const remoteItemMap = {};
      const localMeta = this.config.get('meta', {});
      const firstSync = !localMeta.timestamp;
      const outdated = !localMeta.timestamp || remoteMeta.timestamp > localMeta.timestamp;
      this.log('First sync:', firstSync);
      this.log('Outdated:', outdated, '(', 'local:', localMeta.timestamp, 'remote:', remoteMeta.timestamp, ')');
      const getRemote = [];
      const putRemote = [];
      const delRemote = [];
      const delLocal = [];
      remoteMeta.info = remoteData.reduce((info, item) => {
        remoteItemMap[item.uri] = item;
        let itemInfo = remoteMetaInfo[item.uri];
        if (!itemInfo) {
          itemInfo = {};
          remoteChanged = true;
        }
        info[item.uri] = itemInfo;
        if (!itemInfo.modified) {
          itemInfo.modified = now;
          remoteChanged = true;
        }
        return info;
      }, {});
      localData.forEach(item => {
        const remoteInfo = remoteMeta.info[item.uri];
        if (remoteInfo) {
          if (firstSync || !item.custom.modified || remoteInfo.modified > item.custom.modified) {
            const remoteItem = remoteItemMap[item.uri];
            getRemote.push(remoteItem);
          } else if (remoteInfo.modified < item.custom.modified) {
            putRemote.push(item);
          } else if (remoteInfo.position !== item.position) {
            remoteInfo.position = item.position;
            remoteChanged = true;
          }
          delete remoteItemMap[item.uri];
        } else if (firstSync || !outdated) {
          putRemote.push(item);
        } else {
          delLocal.push(item);
        }
      });
      Object.keys(remoteItemMap).forEach(uri => {
        const item = remoteItemMap[uri];
        if (outdated) {
          getRemote.push(item);
        } else {
          delRemote.push(item);
        }
      });
      const promiseQueue = [].concat(
        getRemote.map(item => {
          this.log('Download script:', item.uri);
          return this.get(getFilename(item.uri))
          .then(raw => {
            const data = { more: {} };
            try {
              const obj = JSON.parse(raw);
              if (obj.version === 1) {
                data.code = obj.code;
                if (obj.more) data.more = obj.more;
              }
            } catch (e) {
              data.code = raw;
            }
            const remoteInfo = remoteMeta.info[item.uri];
            const { modified, position } = remoteInfo;
            data.modified = modified;
            if (position) data.more.position = position;
            if (!getOption('syncScriptStatus') && data.more) {
              delete data.more.enabled;
            }
            return parseScript(data)
            .then(res => { browser.runtime.sendMessage(res); });
          });
        }),
        putRemote.map(item => {
          this.log('Upload script:', item.uri);
          const data = JSON.stringify({
            version: 1,
            code: item.code,
            more: {
              custom: item.custom,
              enabled: item.enabled,
              update: item.update,
            },
          });
          remoteMeta.info[item.uri] = {
            modified: item.custom.modified,
            position: item.position,
          };
          remoteChanged = true;
          return this.put(getFilename(item.uri), data);
        }),
        delRemote.map(item => {
          this.log('Remove remote script:', item.uri);
          delete remoteMeta.info[item.uri];
          remoteChanged = true;
          return this.remove(getFilename(item.uri));
        }),
        delLocal.map(item => {
          this.log('Remove local script:', item.uri);
          return removeScript(item.id);
        }),
      );
      promiseQueue.push(Promise.all(promiseQueue).then(() => checkPosition()).then(changed => {
        if (!changed) return;
        remoteChanged = true;
        return getScriptsByIndex('position', null, null, item => {
          const remoteInfo = remoteMeta.info[item.uri];
          if (remoteInfo) remoteInfo.position = item.position;
        });
      }));
      promiseQueue.push(Promise.all(promiseQueue).then(() => {
        const promises = [];
        if (remoteChanged) {
          remoteMeta.timestamp = Date.now();
          promises.push(this.put(this.metaFile, JSON.stringify(remoteMeta)));
        }
        localMeta.timestamp = remoteMeta.timestamp;
        localMeta.lastSync = Date.now();
        this.config.set('meta', localMeta);
        return Promise.all(promises);
      }));
      // ignore errors to ensure all promises are fulfilled
      return Promise.all(promiseQueue.map(promise => promise.then(noop, err => err || true)))
      .then(errors => errors.filter(Boolean))
      .then(errors => { if (errors.length) throw errors; });
    })
    .then(() => {
      this.syncState.set('idle');
    }, err => {
      this.syncState.set('error');
      this.log('Failed syncing:', this.name);
      this.log(err);
    });
  },
});

export function register(factory) {
  const service = typeof factory === 'function' ? factory() : factory;
  serviceNames.push(service.name);
  services[service.name] = service;
  return service;
}
function getCurrent() {
  return syncConfig.get('current');
}
function getService(name) {
  return services[name || getCurrent()];
}
export function initialize() {
  const service = getService();
  if (service) service.checkSync();
}

function syncOne(service) {
  if (service.syncState.is(['ready', 'syncing'])) return;
  if (service.authState.is(['idle', 'error'])) return service.checkSync();
  if (service.authState.is('authorized')) return service.startSync();
}
export function sync() {
  const service = getService();
  return service && Promise.resolve(syncOne(service)).then(autoSync);
}

export function checkAuthUrl(url) {
  return serviceNames.some(name => {
    const service = services[name];
    return service.checkAuth && service.checkAuth(url);
  });
}

export function authorize() {
  const service = getService();
  if (service) service.authorize();
}
export function revoke() {
  const service = getService();
  if (service) service.revoke();
}

hookOptions(data => {
  if ('sync.current' in data) initialize();
});
