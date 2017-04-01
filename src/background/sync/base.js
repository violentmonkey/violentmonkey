import { debounce, normalizeKeys, noop, request } from 'src/common';
import getEventEmitter from '../utils/events';
import { getOption, setOption, hookOptions } from '../utils/options';
import { getScriptsByIndex, parseScript, saveScript, removeScript } from '../utils/db';

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
  const initService = (...args) => {
    const service = Object.create(base);
    service.initialize(...args);
    return service;
  };
  initService.extend = options => serviceFactory(Object.assign(Object.create(base), options));
  return initService;
}
export const BaseService = serviceFactory({
  name: 'base',
  displayName: 'BaseService',
  delayTime: 1000,
  urlPrefix: '',
  metaFile: 'Violentmonkey',
  delay(time) {
    return new Promise(resolve => { setTimeout(resolve, time); });
  },
  initialize(name) {
    this.onStateChange = debounce(this.onStateChange.bind(this));
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
    ], null, this.onStateChange);
    this.syncState = serviceState([
      'idle',
      'ready',
      'syncing',
      'error',
    ], null, this.onStateChange);
    // this.initToken();
    this.lastFetch = Promise.resolve();
    this.startSync = this.syncFactory();
    const events = getEventEmitter();
    ['on', 'off', 'fire']
    .forEach(key => {
      this[key] = (...args) => { events[key](...args); };
    });
  },
  onStateChange() {
    browser.runtime.sendMessage({
      cmd: 'UpdateSync',
      data: getStates(),
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
  request(options) {
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
    this.onStateChange();
    return lastFetch.then(() => {
      let { prefix } = options;
      if (prefix == null) prefix = this.urlPrefix;
      const headers = Object.assign({}, this.headers, options.headers);
      return request(prefix + options.url, {
        headers,
        method: options.method,
        body: options.body,
      })
      .then(data => ({ data }), error => ({ error }))
      .then(({ data, error }) => {
        progress.finished += 1;
        this.onStateChange();
        if (error) return Promise.reject(error);
        return data;
      });
    });
  },
  sync() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.syncState.set('syncing');
    return this.getMeta()
    .then(meta => Promise.all([
      meta,
      this.list(),
      getScriptsByIndex('position'),
    ]))
    .then(([meta, remoteData, localData]) => {
      const remote = {
        meta,
        data: remoteData,
      };
      const local = {
        meta: this.config.get('meta', {}),
        data: localData,
      };
      const firstSync = !local.meta.timestamp;
      const outdated = !local.meta.timestamp || remote.meta.timestamp > local.meta.timestamp;
      this.log('First sync:', firstSync);
      this.log('Outdated:', outdated, '(', 'local:', local.meta.timestamp, 'remote:', remote.meta.timestamp, ')');
      const map = {};
      const getRemote = [];
      const putRemote = [];
      const delRemote = [];
      const delLocal = [];
      remote.data.forEach(item => { map[item.uri] = item; });
      local.data.forEach(item => {
        const remoteItem = map[item.uri];
        if (remoteItem) {
          if (firstSync || !item.custom.modified || remoteItem.modified > item.custom.modified) {
            getRemote.push(remoteItem);
          } else if (remoteItem.modified < item.custom.modified) {
            putRemote.push(item);
          }
          delete map[item.uri];
        } else if (firstSync || !outdated) {
          putRemote.push(item);
        } else {
          delLocal.push(item);
        }
      });
      Object.keys(map).forEach(uri => {
        const item = map[uri];
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
            const data = {};
            try {
              const obj = JSON.parse(raw);
              if (obj.version === 1) {
                data.code = obj.code;
                data.more = obj.more;
              }
            } catch (e) {
              data.code = raw;
            }
            data.modified = item.modified;
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
          return this.put(getFilename(item.uri), data)
          .then(res => {
            if (item.custom.modified !== res.modified) {
              item.custom.modified = res.modified;
              return saveScript(item);
            }
          });
        }),
        delRemote.map(item => {
          this.log('Remove remote script:', item.uri);
          return this.remove(getFilename(item.uri));
        }),
        delLocal.map(item => {
          this.log('Remove local script:', item.uri);
          return removeScript(item.id);
        }),
      );
      promiseQueue.push(Promise.all(promiseQueue).then(() => {
        const promises = [];
        let remoteChanged;
        if (!remote.meta.timestamp || putRemote.length || delRemote.length) {
          remoteChanged = true;
          remote.meta.timestamp = Date.now();
          promises.push(this.put(this.metaFile, JSON.stringify(remote.meta)));
        }
        if (
          !local.meta.timestamp
          || getRemote.length
          || delLocal.length
          || remoteChanged
          || outdated
        ) {
          local.meta.timestamp = remote.meta.timestamp;
        }
        local.meta.lastSync = Date.now();
        this.config.set('meta', local.meta);
        return Promise.all(promises);
      }));
      // ignore errors to ensure all promises are fulfilled
      return Promise.all(promiseQueue.map(promise => promise.catch(err => err || true)))
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
