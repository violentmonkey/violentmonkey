import {
  debounce,
  normalizeKeys,
  request,
  noop,
  makePause,
  sendCmd,
  buffer2string,
  getRandomString,
} from '@/common';
import { TIMEOUT_HOUR, NO_CACHE } from '@/common/consts';
import {
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
  USER_CONFIG,
} from '@/common/consts-sync';
import {
  forEachEntry,
  objectSet,
  objectPick,
  objectGet,
} from '@/common/object';
import { getOption, setOption } from '../utils';
import { sortScripts, updateScriptInfo } from '../utils/db';
import { script as pluginScript } from '../plugin';
import {
  events,
  getSyncState,
  resetSyncState,
  setSyncState,
  SYNC_AUTHORIZED,
  SYNC_AUTHORIZING,
  SYNC_ERROR,
  SYNC_ERROR_AUTH,
  SYNC_ERROR_INIT,
  SYNC_IN_PROGRESS,
  SYNC_INITIALIZING,
  SYNC_UNAUTHORIZED,
} from './state-machine';
import { formatDate } from '@/common/date';

export const INIT_SUCCESS = 0;
export const INIT_UNAUTHORIZED = 1;
export const INIT_RETRY = 2;
export const INIT_ERROR = 2;

const serviceNames = [];
const serviceClasses = [];
const services = {};
const syncLater = debounce(autoSync, TIMEOUT_HOUR);
let syncConfig;
let syncMode = SYNC_MERGE;

function getDateString() {
  return formatDate('YYYY-MM-DD HH:mm:ss');
}

function log(type, ...args) {
  console[type](`[${getDateString()}][sync]`, ...args);
}

const logInfo = log.bind(null, 'info');
const logError = log.bind(null, 'warn');

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
export function getStates() {
  return serviceNames.map((name) => {
    const service = services[name];
    const { error } = service;
    return {
      name: service.name,
      displayName: service.displayName,
      error: isObject(error) ? error.message || JSON.stringify(error) : error,
      state: getSyncState(),
      lastSync: service.config.get('meta', {}).lastSync,
      progress: service.progress,
      properties: service.properties,
      hasAuth: service.hasAuth(),
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
events.on('change', (state) => {
  logInfo('status:', state.status);
  onStateChange();
});

export const BaseService = serviceFactory({
  name: 'base',
  displayName: 'BaseService',
  urlPrefix: '',
  metaFile: VIOLENTMONKEY,
  properties: {
    authType: 'oauth',
  },

  // Methods to be implemented or overridden
  getUserConfig: noop,
  setUserConfig: noop,
  requestAuth: noop,
  authorize: noop,
  revoke: noop,
  authorized: noop,
  matchAuth: noop,
  finishAuth: noop,
  metaError: noop,
  hasAuth() {
    const token = this.config.get('token');
    return !!token;
  },
  initToken() {
    const token = this.config.get('token');
    this.headers = token
      ? {
          authorization: `Bearer ${token}`,
        }
      : null;
    return !!token;
  },
  getSyncData() {
    return Promise.all([this.getMeta(), this.list(), this.getLocalData()]);
  },

  initialize() {
    this.progress = {
      finished: 0,
      total: 0,
    };
    this.config = serviceConfig(this.name);
    this.lastFetch = Promise.resolve();
  },
  logError(err) {
    logError(err);
    this.error = err;
  },
  async _refreshToken() {
    const refreshToken = this.config.get('refresh_token');
    if (!refreshToken) throw new Error('Invalid refresh token');
    await this.authorized({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    this.initToken();
  },
  async _refresh() {
    setSyncState({ status: SYNC_INITIALIZING });
    let result;
    try {
      result = await this.requestAuth();
      if (result?.code === INIT_RETRY) {
        await this._refreshToken();
        result = await this.requestAuth();
      }
      if (result && ![INIT_SUCCESS, INIT_UNAUTHORIZED].includes(result.code)) {
        throw result.error || { message: 'unknown refresh error' };
      }
    } catch (err) {
      setSyncState({ status: SYNC_ERROR_INIT });
      this.logError(err);
      throw err;
    }
    setSyncState({
      status:
        result?.code === INIT_UNAUTHORIZED
          ? SYNC_UNAUTHORIZED
          : SYNC_AUTHORIZED,
    });
  },
  prepare() {
    if (this.initToken()) return this._refresh();
    setSyncState({
      status: SYNC_UNAUTHORIZED,
    });
  },
  async handleAuth(payload) {
    setSyncState({ status: SYNC_AUTHORIZING });
    try {
      await this.finishAuth(payload);
    } catch (err) {
      setSyncState({ status: SYNC_ERROR_AUTH });
      throw err;
    }
    setSyncState({ status: SYNC_AUTHORIZED });
    autoSync();
  },
  checkAuth(url) {
    const payload = this.matchAuth(url);
    if (payload) {
      this.handleAuth(payload);
      return true;
    }
  },
  getMeta() {
    return this.get({ name: this.metaFile })
      .then((data) => JSON.parse(data))
      .catch((err) => this.metaError(err))
      .then((data) => ({
        name: this.metaFile,
        data,
      }));
  },
  _requestDelay: 0,
  async _request(options) {
    options = Object.assign({}, NO_CACHE, options);
    options.headers = Object.assign({}, this.headers, options.headers);
    let { url } = options;
    if (url.startsWith('/')) url = (options.prefix ?? this.urlPrefix) + url;
    let delay = this._requestDelay;
    let attempts = 5;
    while (attempts > 0) {
      attempts -= 1;
      if (delay >= 200) await makePause(delay);
      try {
        const res = await request(url, options);
        this._requestDelay >>= 1;
        return res.data;
      } catch (err) {
        if (err?.status !== 429 || attempts <= 0) throw err;
        const retryAfter = err.headers?.get('retry-after');
        const serverDelay =
          retryAfter &&
          (isNaN(+retryAfter)
            ? new Date(retryAfter).getTime() - Date.now()
            : +retryAfter * 1000);
        if (serverDelay) {
          delay = serverDelay;
        } else {
          delay = Math.max(1000, delay * 2);
          this._requestDelay = delay;
        }
      }
    }
  },
  _requestProcessing: false,
  async _handleRequests() {
    if (this._requestProcessing) return;
    this._requestProcessing = true;
    while (this._requestQueue.length) {
      const task = this._requestQueue.shift();
      task.resolve(this._request(task.options));
      await task.promise.catch(noop);
      this.progress.finished += 1;
      onStateChange();
    }
    this._requestProcessing = false;
  },
  loadData(options) {
    const task = { options };
    task.promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    (this._requestQueue ||= []).push(task);
    this.progress.total += 1;
    onStateChange();
    this._handleRequests();
    return task.promise;
  },
  getLocalData() {
    return pluginScript.list();
  },
  async sync() {
    try {
      await this.prepare();
    } catch {
      // Sync in progress, ignore
    }
    if (getSyncState().status !== SYNC_AUTHORIZED || getCurrent() !== this.name)
      return;
    setSyncState({ status: SYNC_IN_PROGRESS });
    try {
      await this._sync();
      logInfo('Sync finished:', this.displayName);
    } catch (err) {
      setSyncState({ status: SYNC_ERROR });
      logInfo('Failed syncing:', this.displayName);
      this.logError(err);
      throw err;
    }
    setSyncState({ status: SYNC_AUTHORIZED });
  },
  async _sync() {
    const currentSyncMode = syncMode;
    syncMode = SYNC_MERGE;
    this.progress = {
      finished: 0,
      total: 0,
    };
    const [remoteMeta, remoteData, localData] = await this.getSyncData();
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
    logInfo('First sync:', firstSync);
    logInfo('Sync mode:', currentSyncMode);
    logInfo(
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
        if (firstSync || !outdated || localModified > remoteTimestamp) return 1;
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
      const result = compareItems(null, item, info);
      if (result < 0) {
        putLocal.push({ remote: item, info });
      } else {
        delRemote.push({ remote: item });
      }
    });
    const promiseQueue = [
      ...putLocal.map(({ remote, info }) => {
        logInfo('Download script:', remote.uri);
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
        logInfo('Upload script:', local.props.uri);
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
        logInfo('Remove remote script:', remote.uri);
        delete remoteMetaData.info[remote.uri];
        remoteChanged = true;
        return this.remove(remote);
      }),
      ...delLocal.map(({ local }) => {
        logInfo('Remove local script:', local.props.uri);
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
          promises.push(this.put(remoteMeta, JSON.stringify(remoteMetaData)));
        }
        localMeta.timestamp = remoteMetaData.timestamp;
        localMeta.lastSync = Date.now();
        this.config.set('meta', localMeta);
        return Promise.all(promises);
      }),
    );
    // ignore errors to ensure all promises are fulfilled
    return Promise.all(
      promiseQueue.map((promise) => promise.then(noop, (err) => err || true)),
    )
      .then((errors) => errors.filter(Boolean))
      .then((errors) => {
        if (errors.length) throw errors;
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
    serviceClasses.forEach((Factory) => {
      const service = new Factory();
      const { name } = service;
      serviceNames.push(name);
      services[name] = service;
    });
  }
  resetSyncState();
  return autoSync();
}

export function sync() {
  const service = getService();
  return service && Promise.resolve(service.sync()).then(syncLater);
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
    return service.sync();
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
