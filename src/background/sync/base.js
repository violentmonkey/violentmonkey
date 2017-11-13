import { debounce, normalizeKeys, request, noop } from 'src/common';
import { objectSet, objectPurify } from 'src/common/object';
import { getEventEmitter, getOption, setOption, hookOptions } from '../utils';
import {
  getScripts,
  getScriptCode,
  parseScript,
  removeScript,
  sortScripts,
  updateScriptInfo,
} from '../utils/db';

const serviceNames = [];
const serviceClasses = [];
const services = {};
const autoSync = debounce(sync, 60 * 60 * 1000);
let working = Promise.resolve();
let syncConfig;

export function getItemFilename({ name: filename, uri }) {
  return uri ? getFilename(uri) : filename;
}
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
  const Service = function constructor() {
    this.initialize();
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
  initialize() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.config = serviceConfig(this.name);
    this.authState = serviceState([
      'idle',
      'initializing',
      'authorizing', // in case some services require asynchronous requests to get access_tokens
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
    this.lastFetch = Promise.resolve();
    this.startSync = this.syncFactory();
    const events = getEventEmitter();
    ['on', 'off', 'fire']
    .forEach(key => {
      this[key] = (...args) => { events[key](...args); };
    });
  },
  log(...args) {
    console.log(...args); // eslint-disable-line no-console
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
        this.authState.set('unauthorized');
        if (this.config.get('token') && getOption('syncReauthorize') && !this.config.get('reauthorized')) {
          this.config.set({
            reauthorized: true,
          });
          this.authorize();
        }
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
  handleMetaError(err) {
    throw err;
  },
  getMeta() {
    return this.get({ name: this.metaFile })
    .then(data => JSON.parse(data))
    .catch(err => this.handleMetaError(err));
  },
  initToken() {
    this.prepareHeaders();
    const token = this.config.get('token');
    this.headers.Authorization = token ? `Bearer ${token}` : null;
    return !!token;
  },
  loadData(options) {
    const { progress } = this;
    let { delay } = options;
    if (delay == null) {
      delay = this.delayTime;
    }
    let lastFetch = Promise.resolve();
    if (delay) {
      lastFetch = this.lastFetch
      .then(ts => new Promise(resolve => {
        const delta = delay - (Date.now() - ts);
        if (delta > 0) {
          setTimeout(resolve, delta);
        } else {
          resolve();
        }
      }))
      .then(() => Date.now());
      this.lastFetch = lastFetch;
    }
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
  getLocalData() {
    return getScripts()
    .then(scripts => scripts.filter(script => !script.config.removed));
  },
  getSyncData() {
    return this.getMeta()
    .then(remoteMetaData => Promise.all([
      { name: this.metaFile, data: remoteMetaData },
      this.list(),
      this.getLocalData(),
    ]));
  },
  sync() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.syncState.set('syncing');
    // Avoid simultaneous requests
    return this.prepare()
    .then(() => this.getSyncData())
    .then(([remoteMeta, remoteData, localData]) => {
      const { data: remoteMetaData } = remoteMeta;
      const remoteMetaInfo = remoteMetaData.info || {};
      const remoteTimestamp = remoteMetaData.timestamp || 0;
      let remoteChanged = !remoteTimestamp
        || Object.keys(remoteMetaInfo).length !== remoteData.length;
      const now = Date.now();
      const globalLastModified = getOption('lastModified');
      const remoteItemMap = {};
      const localMeta = this.config.get('meta', {});
      const firstSync = !localMeta.timestamp;
      const outdated = firstSync || remoteTimestamp > localMeta.timestamp;
      this.log('First sync:', firstSync);
      this.log('Outdated:', outdated, '(', 'local:', localMeta.timestamp, 'remote:', remoteTimestamp, ')');
      const putLocal = [];
      const putRemote = [];
      const delRemote = [];
      const delLocal = [];
      const updateLocal = [];
      remoteMetaData.info = remoteData.reduce((info, item) => {
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
        const { props: { uri, position, lastModified } } = item;
        const remoteInfo = remoteMetaData.info[uri];
        if (remoteInfo) {
          const remoteItem = remoteItemMap[uri];
          if (firstSync || !lastModified || remoteInfo.modified > lastModified) {
            putLocal.push({ local: item, remote: remoteItem, info: remoteInfo });
          } else {
            if (remoteInfo.modified < lastModified) {
              putRemote.push({ local: item, remote: remoteItem });
              remoteInfo.modified = lastModified;
              remoteChanged = true;
            }
            if (remoteInfo.position !== position) {
              if (remoteInfo.position && globalLastModified <= remoteTimestamp) {
                updateLocal.push({ local: item, remote: remoteItem, info: remoteInfo });
              } else {
                remoteInfo.position = position;
                remoteChanged = true;
              }
            }
          }
          delete remoteItemMap[uri];
        } else if (firstSync || !outdated || lastModified > remoteTimestamp) {
          putRemote.push({ local: item });
        } else {
          delLocal.push({ local: item });
        }
      });
      Object.keys(remoteItemMap).forEach(uri => {
        const item = remoteItemMap[uri];
        const info = remoteMetaData.info[uri];
        if (outdated) {
          putLocal.push({ remote: item, info });
        } else {
          delRemote.push({ remote: item });
        }
      });
      const promiseQueue = [
        ...putLocal.map(({ remote, info }) => {
          this.log('Download script:', remote.uri);
          return this.get(remote)
          .then(raw => {
            const data = {};
            try {
              const obj = JSON.parse(raw);
              data.code = obj.code;
              if (obj.version === 2) {
                data.config = obj.config;
                data.custom = obj.custom;
                data.props = obj.props;
              } else if (obj.version === 1) {
                if (obj.more) {
                  data.custom = obj.more.custom;
                  data.config = objectPurify({
                    enabled: obj.more.enabled,
                    shouldUpdate: obj.more.update,
                  });
                  data.props = objectPurify({
                    lastUpdated: obj.more.lastUpdated,
                  });
                }
              }
            } catch (e) {
              data.code = raw;
            }
            // Invalid data
            if (!data.code) return;
            if (info.modified) objectSet(data, 'props.lastModified', info.modified);
            const position = +info.position;
            if (position) data.position = position;
            if (!getOption('syncScriptStatus') && data.config) {
              delete data.config.enabled;
            }
            return parseScript(data)
            .then(res => { browser.runtime.sendMessage(res); });
          });
        }),
        ...putRemote.map(({ local, remote }) => {
          this.log('Upload script:', local.props.uri);
          return getScriptCode(local.props.id)
          .then(code => {
            // const data = {
            //   version: 2,
            //   code,
            //   custom: script.custom,
            //   config: script.config,
            //   props: objectPick(script.props, ['lastUpdated']),
            // };
            // XXX use version 1 to be compatible with Violentmonkey on other platforms
            const data = {
              version: 1,
              code,
              more: {
                custom: local.custom,
                enabled: local.config.enabled,
                update: local.config.shouldUpdate,
                lastUpdated: local.props.lastUpdated,
              },
            };
            remoteMetaData.info[local.props.uri] = {
              modified: local.props.lastModified,
              position: local.props.position,
            };
            remoteChanged = true;
            return this.put(
              Object.assign({}, remote, { uri: local.props.uri }),
              JSON.stringify(data),
            );
          });
        }),
        ...delRemote.map(({ remote }) => {
          this.log('Remove remote script:', remote.uri);
          delete remoteMetaData.info[remote.uri];
          remoteChanged = true;
          return this.remove(remote);
        }),
        ...delLocal.map(({ local }) => {
          this.log('Remove local script:', local.props.uri);
          return removeScript(local.props.id);
        }),
        ...updateLocal.map(({ local, info }) => {
          const updates = {};
          if (info.position) {
            updates.props = { position: info.position };
          }
          return updateScriptInfo(local.props.id, updates);
        }),
      ];
      promiseQueue.push(Promise.all(promiseQueue).then(() => sortScripts()).then(changed => {
        if (!changed) return;
        remoteChanged = true;
        return getScripts().then(scripts => {
          scripts.forEach(script => {
            const remoteInfo = remoteMetaData.info[script.props.uri];
            if (remoteInfo) remoteInfo.position = script.props.position;
          });
        });
      }));
      promiseQueue.push(Promise.all(promiseQueue).then(() => {
        const promises = [];
        if (remoteChanged) {
          remoteMetaData.timestamp = Date.now();
          promises.push(this.put(remoteMeta, JSON.stringify(remoteMetaData)));
        }
        localMeta.timestamp = remoteMetaData.timestamp;
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

export function register(Factory) {
  serviceClasses.push(Factory);
}
function getCurrent() {
  return syncConfig.get('current');
}
function getService(name) {
  return services[name || getCurrent()];
}
export function initialize() {
  if (!syncConfig) {
    syncConfig = initConfig();
    serviceClasses.forEach(Factory => {
      const service = new Factory();
      const { name } = service;
      serviceNames.push(name);
      services[name] = service;
    });
  }
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
    const authorized = service.checkAuth && service.checkAuth(url);
    if (authorized) {
      service.config.set({
        reauthorized: false,
      });
    }
    return authorized;
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
