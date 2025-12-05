import {
  debounce,
  normalizeKeys,
  request,
  noop,
  makePause,
  ensureArray,
  sendCmd,
  buffer2string,
  getRandomString,
} from '@/common';
import { TIMEOUT_HOUR, NO_CACHE } from '@/common/consts';
import {
  AUTHORIZED,
  AUTHORIZING,
  ERROR,
  IDLE,
  INITIALIZING,
  NO_AUTH,
  READY,
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
  SYNCING,
  UNAUTHORIZED,
  USER_CONFIG,
} from '@/common/consts-sync';
import {
  forEachEntry,
  objectSet,
  objectPick,
  objectGet,
} from '@/common/object';
import { getEventEmitter, getOption, setOption } from '../utils';
import { sortScripts, updateScriptInfo } from '../utils/db';
import { script as pluginScript } from '../plugin';

const serviceNames = [];
const serviceClasses = [];
const services = {};
const syncLater = debounce(autoSync, TIMEOUT_HOUR);
let working = Promise.resolve();
let syncConfig;
let syncMode = SYNC_MERGE;

export function setSyncOnceMode(mode) {
  syncMode = mode;
}

export function getItemFilename({ name, uri }) {
  // When get or remove, current name should be prefered
  if (name) return name;
  // otherwise uri derived name should be prefered
  // uri is already encoded by `encodeFilename`
  return `vm@2-${uri}`;
}
export function isScriptFile(name) {
  return /^vm(?:@\d+)?-/.test(name);
}
export function getURI(name) {
  const i = name.indexOf('-');
  const [, version] = name.slice(0, i).split('@');
  if (version === '2') {
    // uri is encoded by `encodedFilename`, so we should not decode it here
    return name.slice(i + 1);
  }
  try {
    return decodeURIComponent(name.slice(3));
  } catch (err) {
    return name.slice(3);
  }
}

function initConfig() {
  function get(key, def) {
    const keys = normalizeKeys(key);
    keys.unshift('sync');
    return getOption(keys) ?? def;
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
    if (isObject(key)) {
      key::forEachEntry(([k, v]) => {
        syncConfig.set(getKeys(k), v);
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
    return ensureArray(states).includes(state);
  }
  return { get, set, is };
}
export function getStates() {
  return serviceNames.map((name) => {
    const service = services[name];
    const { error } = service;
    return {
      name: service.name,
      displayName: service.displayName,
      error: isObject(error) ? error.message || JSON.stringify(error) : error,
      authState: service.authState.get(),
      syncState: service.syncState.get(),
      lastSync: service.config.get('meta', {}).lastSync,
      progress: service.progress,
      properties: service.properties,
      [USER_CONFIG]: service.getUserConfig(),
    };
  });
}

function getScriptData(script, syncVersion, extra) {
  let data;
  if (syncVersion === 2) {
    data = {
      version: syncVersion,
      custom: script.custom,
      config: script.config,
      props: objectPick(script.props, ['lastUpdated']),
    };
  } else if (syncVersion === 1) {
    data = {
      version: syncVersion,
      more: {
        custom: script.custom,
        enabled: script.config.enabled,
        update: script.config.shouldUpdate,
        lastUpdated: script.props.lastUpdated,
      },
    };
  }
  return Object.assign(data, extra);
}
function parseScriptData(raw) {
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
  return data;
}

function objectPurify(obj) {
  // Remove keys with undefined values
  if (Array.isArray(obj)) {
    obj.forEach(objectPurify);
  } else if (isObject(obj)) {
    obj::forEachEntry(([key, value]) => {
      if (typeof value === 'undefined') delete obj[key];
      else objectPurify(value);
    });
  }
  return obj;
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
  sendCmd('UpdateSync', getStates());
});

export const BaseService = serviceFactory({
  name: 'base',
  displayName: 'BaseService',
  delayTime: 1000,
  urlPrefix: '',
  metaFile: VIOLENTMONKEY,
  properties: {
    authType: 'oauth',
  },
  getUserConfig: noop,
  setUserConfig: noop,
  initialize() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.config = serviceConfig(this.name);
    this.authState = serviceState(
      [
        IDLE,
        NO_AUTH,
        INITIALIZING,
        AUTHORIZING, // in case some services require asynchronous requests to get access_tokens
        AUTHORIZED,
        UNAUTHORIZED,
        ERROR,
      ],
      null,
      onStateChange,
    );
    this.syncState = serviceState(
      [IDLE, READY, SYNCING, ERROR],
      null,
      onStateChange,
    );
    this.lastFetch = Promise.resolve();
    this.startSync = this.syncFactory();
    const events = getEventEmitter();
    ['on', 'off', 'fire'].forEach((key) => {
      this[key] = (...args) => {
        events[key](...args);
      };
    });
  },
  log(...args) {
    console.log(...args); // eslint-disable-line no-console
  },
  logError(err) {
    console.warn(err);
    this.error = err;
  },
  syncFactory() {
    let promise;
    let debouncedResolve;
    const shouldSync = () =>
      this.authState.is(AUTHORIZED) && getCurrent() === this.name;
    const getReady = () => {
      if (!shouldSync()) return Promise.resolve();
      this.log('Ready to sync:', this.displayName);
      this.syncState.set(READY);
      working = working
        .then(
          () =>
            new Promise((resolve) => {
              debouncedResolve = debounce(resolve, 10 * 1000);
              debouncedResolve();
            }),
        )
        .then(() => {
          if (shouldSync()) return this.sync();
          this.syncState.set(IDLE);
        })
        .catch((err) => this.logError(err))
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
  prepare(promise) {
    this.authState.set(INITIALIZING);
    return Promise.resolve(promise)
      .then(() =>
        this.initToken()
          ? this.user()
          : Promise.reject({
              type: NO_AUTH,
            }),
      )
      .then(
        () => {
          this.authState.set(AUTHORIZED);
        },
        (err) => {
          if ([NO_AUTH, UNAUTHORIZED].includes(err?.type)) {
            this.authState.set(err.type);
          } else {
            this.logError(err);
            this.authState.set(ERROR);
          }
          this.syncState.set(IDLE);
          throw err;
        },
      );
  },
  checkSync(promise) {
    return this.prepare(promise).then(() => this.startSync());
  },
  user: noop,
  acquireLock: noop,
  releaseLock: noop,
  handleMetaError(err) {
    throw err;
  },
  getMeta() {
    return this.get({ name: this.metaFile })
      .then((data) => JSON.parse(data))
      .catch((err) => this.handleMetaError(err))
      .then((data) => ({
        name: this.metaFile,
        data,
      }));
  },
  initToken() {
    this.prepareHeaders();
    const token = this.config.get('token');
    this.headers.Authorization = token ? `Bearer ${token}` : null;
    return !!token;
  },
  loadData(options) {
    const { progress } = this;
    const { delay = this.delayTime } = options;
    let lastFetch = Promise.resolve();
    if (delay) {
      lastFetch = this.lastFetch
        .then((ts) => makePause(delay - (Date.now() - ts)))
        .then(() => Date.now());
      this.lastFetch = lastFetch;
    }
    progress.total += 1;
    onStateChange();
    return lastFetch
      .then(() => {
        options = Object.assign({}, NO_CACHE, options);
        options.headers = Object.assign({}, this.headers, options.headers);
        let { url } = options;
        if (url.startsWith('/')) url = (options.prefix ?? this.urlPrefix) + url;
        return request(url, options);
      })
      .catch((error) => ({ error }))
      .then(({ data, error }) => {
        progress.finished += 1;
        onStateChange();
        if (error) return Promise.reject(error);
        return data;
      });
  },
  getLocalData() {
    return pluginScript.list();
  },
  getSyncData() {
    return this.getMeta().then((remoteMeta) =>
      Promise.all([remoteMeta, this.list(), this.getLocalData()]),
    );
  },
  sync() {
    const currentSyncMode = syncMode;
    syncMode = SYNC_MERGE;
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.syncState.set(SYNCING);
    // Avoid simultaneous requests
    return this.prepare()
      .then(() => this.getSyncData())
      .then((data) => Promise.resolve(this.acquireLock()).then(() => data))
      .then(([remoteMeta, remoteData, localData]) => {
        const remoteMetaData = remoteMeta.data || {};
        const remoteMetaInfo = remoteMetaData.info || {};
        const remoteTimestamp = remoteMetaData.timestamp || 0;
        let remoteChanged =
          !remoteTimestamp ||
          Object.keys(remoteMetaInfo).length !== remoteData.length;
        const now = Date.now();
        const globalLastModified = getOption('lastModified');
        const remoteItemMap = {};
        const localMeta = this.config.get('meta', {});
        const firstSync = !localMeta.timestamp;
        const outdated = firstSync || remoteTimestamp > localMeta.timestamp;
        this.log('First sync:', firstSync);
        this.log('Sync mode:', currentSyncMode);
        this.log(
          'Outdated:',
          outdated,
          '(',
          'local:',
          localMeta.timestamp,
          'remote:',
          remoteTimestamp,
          ')',
        );
        const putLocal = [];
        const putRemote = [];
        const delRemote = [];
        const delLocal = [];
        const updateLocal = [];
        const compareItems = (localItem, remoteItem, remoteInfo) => {
          if (currentSyncMode === SYNC_PUSH) return 1;
          if (currentSyncMode === SYNC_PULL) return -1;
          const localModified = objectGet(localItem, 'props.lastModified');
          if (localItem && remoteItem && remoteInfo) {
            const remoteModified = remoteInfo.modified;
            if (firstSync || !localModified || remoteModified > localModified)
              return -1;
            if (remoteModified < localModified) return 1;
            return 0;
          }
          if (localItem) {
            if (firstSync || !outdated || localModified > remoteTimestamp)
              return 1;
            return -1;
          }
          if (remoteItem) {
            if (outdated) return -1;
            return 1;
          }
        };
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
        localData.forEach((item) => {
          const {
            props: { uri, position, lastModified },
          } = item;
          const remoteInfo = remoteMetaData.info[uri];
          const remoteItem = remoteItemMap[uri];
          delete remoteItemMap[uri];
          const result = compareItems(item, remoteItem, remoteInfo);
          if (result < 0) {
            if (remoteItem) {
              putLocal.push({
                local: item,
                remote: remoteItem,
                info: remoteInfo,
              });
            } else {
              delLocal.push({ local: item });
            }
          } else if (result > 0) {
            putRemote.push({ local: item, remote: remoteItem });
            if (remoteInfo) remoteInfo.modified = lastModified;
            remoteChanged = true;
          } else if (remoteInfo && remoteInfo.position !== position) {
            if (globalLastModified <= remoteTimestamp) {
              updateLocal.push({
                local: item,
                remote: remoteItem,
                info: remoteInfo,
              });
            } else {
              remoteInfo.position = position;
              remoteChanged = true;
            }
          }
        });
        remoteItemMap::forEachEntry(([uri, item]) => {
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
            return this.get(remote).then((raw) => {
              const data = parseScriptData(raw);
              // Invalid data
              if (!data.code) return;
              if (info.modified)
                objectSet(data, 'props.lastModified', info.modified);
              const position = +info.position;
              if (position) data.position = position;
              if (!getOption('syncScriptStatus') && data.config) {
                delete data.config.enabled;
              }
              return pluginScript.update(data);
            });
          }),
          ...putRemote.map(({ local, remote }) => {
            this.log('Upload script:', local.props.uri);
            return pluginScript.get(local.props.id).then((code) => {
              // XXX use version 1 to be compatible with Violentmonkey on other platforms
              const data = getScriptData(local, 1, { code });
              remoteMetaData.info[local.props.uri] = {
                modified: local.props.lastModified,
                position: local.props.position,
              };
              remoteChanged = true;
              return this.put(
                Object.assign({}, remote, {
                  uri: local.props.uri,
                  name: null, // prefer using uri on PUT
                }),
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
            return pluginScript.remove(local.props.id);
          }),
          ...updateLocal.map(({ local, info }) => {
            const updates = {};
            if (info.position) {
              updates.props = { position: info.position };
            }
            return updateScriptInfo(local.props.id, updates);
          }),
        ];
        promiseQueue.push(
          Promise.all(promiseQueue)
            .then(() => sortScripts())
            .then((changed) => {
              if (!changed) return;
              remoteChanged = true;
              return pluginScript.list().then((scripts) => {
                scripts.forEach((script) => {
                  const remoteInfo = remoteMetaData.info[script.props.uri];
                  if (remoteInfo) remoteInfo.position = script.props.position;
                });
              });
            }),
        );
        promiseQueue.push(
          Promise.all(promiseQueue).then(() => {
            const promises = [];
            if (remoteChanged) {
              remoteMetaData.timestamp = Date.now();
              promises.push(
                this.put(remoteMeta, JSON.stringify(remoteMetaData)),
              );
            }
            localMeta.timestamp = remoteMetaData.timestamp;
            localMeta.lastSync = Date.now();
            this.config.set('meta', localMeta);
            return Promise.all(promises);
          }),
        );
        // ignore errors to ensure all promises are fulfilled
        return Promise.all(
          promiseQueue.map((promise) =>
            promise.then(noop, (err) => err || true),
          ),
        )
          .then((errors) => errors.filter(Boolean))
          .then((errors) => {
            if (errors.length) throw errors;
          });
      })
      .then(
        () => {
          this.syncState.set(IDLE);
          this.log('Sync finished:', this.displayName);
        },
        (err) => {
          this.syncState.set(ERROR);
          this.log('Failed syncing:', this.displayName);
          this.logError(err);
        },
      )
      .then(() => Promise.resolve(this.releaseLock()).catch(noop));
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
    serviceClasses.forEach((Factory) => {
      const service = new Factory();
      const { name } = service;
      serviceNames.push(name);
      services[name] = service;
    });
  }
  return autoSync();
}

function syncOne(service) {
  if (service.syncState.is([READY, SYNCING])) return;
  if (service.authState.is([IDLE, ERROR])) return service.checkSync();
  if (service.authState.is(AUTHORIZED)) return service.startSync();
}

export function sync() {
  const service = getService();
  return service && Promise.resolve(syncOne(service)).then(syncLater);
}

export function autoSync() {
  if (!getOption('syncAutomatically')) {
    console.info('[sync] auto-sync disabled, check later');
    const service = getService();
    service.prepare();
    return syncLater();
  }
  sync();
}

export function authorize() {
  const service = getService();
  if (service) service.authorize();
}

export function revoke() {
  const service = getService();
  if (service) service.revoke();
}

export function setConfig(config) {
  const service = getService();
  if (service) {
    service.setUserConfig(config);
    return service.checkSync();
  }
}

let unregister;

export async function openAuthPage(url, redirectUri) {
  unregister?.(); // otherwise our new tabId will be ignored
  const tabId = (await browser.tabs.create({ url })).id;
  /**
   * @param {chrome.webRequest.WebResponseDetails} info
   * @returns {chrome.webRequest.BlockingResponse}
   */
  const handler = (info) => {
    if (getService().checkAuth?.(info.url)) {
      // When onBeforeRequest occurs for initial requests intercepted by service worker,
      // info.tabId will be -1 on Chromium based browsers, use tabId instead.
      // tested on Chrome / Edge / Brave
      browser.tabs.remove(tabId);
      // If we unregister without setTimeout, API will ignore { cancel: true }
      setTimeout(unregister, 0);
      return { cancel: true };
    }
  };
  unregister = () => {
    browser.webRequest.onBeforeRequest.removeListener(handler);
  };
  // Note: match pattern does not support port number
  // - In Chrome, the port number is ignored and the pattern still works
  // - In Firefox, the pattern is ignored and won't match any URL
  redirectUri = redirectUri.replace(/:\d+/, '');
  browser.webRequest.onBeforeRequest.addListener(
    handler,
    {
      // Do not filter by tabId here, see above
      urls: [`${redirectUri}*`],
      types: ['main_frame', 'xmlhttprequest'], // fetch request in service worker
    },
    ['blocking'],
  );
}

const base64urlMapping = {
  '+': '-',
  '/': '_',
};

async function sha256b64url(code) {
  const bin = new TextEncoder().encode(code);
  const buffer = await crypto.subtle.digest('SHA-256', bin);
  const b64 = btoa(buffer2string(buffer));
  return b64.replace(/[+/=]/g, (m) => base64urlMapping[m] || '');
}

/**
 * Create a unique string between 43 and 128 characters long.
 *
 * Ref: RFC 7636
 */
export function getCodeVerifier() {
  return getRandomString(43, 128);
}

export async function getCodeChallenge(codeVerifier) {
  const method = 'S256';
  const challenge = await sha256b64url(codeVerifier);
  return {
    code_challenge: challenge,
    code_challenge_method: method,
  };
}
