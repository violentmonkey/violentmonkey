import { debounce, normalizeKeys, noop, sendCmd } from '@/common';
import { TIMEOUT_HOUR } from '@/common/consts';
import {
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
  USER_CONFIG,
} from '@/common/consts-sync';
import { forEachEntry, objectSet, objectPick } from '@/common/object';
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
import { getSyncActions } from '@usync/sync';
import {
  OAuth2Authorizers,
  OAUTH2_UNAUTHORIZED,
  OAUTH2_NEED_REFRESH,
} from '@usync/oauth2';
import { DriveProviders } from '@usync/drive';

// --- Module-level state ---

const serviceNames = [];
const serviceClasses = [];
const services = {};
const syncLater = debounce(autoSync, TIMEOUT_HOUR);
let syncConfig;
let syncMode = SYNC_MERGE;

// --- Logging ---

function getDateString() {
  return formatDate('YYYY-MM-DD HH:mm:ss');
}

function log(type, ...args) {
  console[type](`[${getDateString()}][sync]`, ...args);
}

const logInfo = log.bind(null, 'info');
const logWarn = log.bind(null, 'warn');

// --- Public exports ---

export function setSyncOnceMode(mode) {
  syncMode = mode;
}

export function getItemFilename({ name, uri }) {
  if (name) return name;
  return `vm@2-${uri}`;
}

export function isScriptFile(name) {
  return /^vm(?:@\d+)?-/.test(name);
}

export function getURI(name) {
  const i = name.indexOf('-');
  const [, version] = name.slice(0, i).split('@');
  if (version === '2') {
    return name.slice(i + 1);
  }
  try {
    return decodeURIComponent(name.slice(3));
  } catch (err) {
    return name.slice(3);
  }
}

// --- Config ---

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

function createServiceConfig(name) {
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
      hasAuth: service.hasAuth,
      [USER_CONFIG]: service.getUserConfig(),
    };
  });
}

// --- Script data serialization ---

function getScriptData(script, extra) {
  const data = {
    version: 2,
    custom: script.custom,
    config: script.config,
    props: objectPick(script.props, ['lastUpdated']),
  };
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

// --- State change listener ---

const onStateChange = debounce(() => {
  sendCmd('UpdateSync', getStates());
});
events.on('change', (state) => {
  logInfo('status:', state.status);
  onStateChange();
});

// --- openAuthPage (Promise-based with timeout) ---

let unregister;
let authResolve = null;
let authTimer = null;

export function openAuthPage(url, redirectUri) {
  unregister?.();
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  authResolve = resolvePromise;
  authTimer = setTimeout(() => {
    authResolve = null;
    resolvePromise(null);
  }, 300_000);
  browser.tabs.create({ url }).then(({ id: tabId }) => {
    const handler = (info) => {
      browser.tabs.remove(tabId);
      setTimeout(unregister, 0);
      if (authResolve) {
        clearTimeout(authTimer);
        authResolve(info.url);
        authResolve = null;
      }
      return { cancel: true };
    };
    unregister = () => {
      browser.webRequest.onBeforeRequest.removeListener(handler);
    };
    redirectUri = redirectUri.replace(/:\d+/, '');
    browser.webRequest.onBeforeRequest.addListener(
      handler,
      {
        urls: [`${redirectUri}*`],
        types: ['main_frame', 'xmlhttprequest'],
      },
      ['blocking'],
    );
  });
  return promise;
}

// --- createSyncService factory ---

export function createSyncService({
  name,
  displayName,
  driveProvider,
  authProvider,
  metaFile = VIOLENTMONKEY,
  config: providerConfig,
  getUserConfig: getUserConfigFn,
  setUserConfig: setUserConfigFn,
  metaError: metaErrorFn,
  mapPasswordAuth,
  properties: extraProperties,
}) {
  let authorizer;
  let drive;
  let serviceConfig;
  let progress = { finished: 0, total: 0 };
  let error;

  function logError(err) {
    logWarn(err);
    error = err;
  }

  // --- OAuth refresh ---

  async function refresh() {
    setSyncState({ status: SYNC_INITIALIZING });
    try {
      try {
        authorizer.getAccessToken();
      } catch (err) {
        if (err.code === OAUTH2_UNAUTHORIZED) {
          setSyncState({ status: SYNC_AUTHORIZING });
          const url = await authorizer.buildAuthUrl();
          const redirectUrl = await openAuthPage(
            url,
            providerConfig.redirect_uri,
          );
          if (!redirectUrl) throw new Error('Authorization timed out');
          await authorizer.finishAuth(new URL(redirectUrl));
        } else if (err.code === OAUTH2_NEED_REFRESH) {
          await authorizer.refreshToken();
        } else {
          throw err;
        }
      }
    } catch (err) {
      setSyncState({ status: SYNC_ERROR_INIT });
      logError(err);
      throw err;
    }
    setSyncState({ status: SYNC_AUTHORIZED });
  }

  // --- Password init ---

  function initPassword() {
    if (!mapPasswordAuth) return false;
    const uc = getUserConfig();
    if (!uc) return false;
    const auth = mapPasswordAuth(uc);
    if (!auth) return false;
    const Drive = DriveProviders[driveProvider];
    drive = new Drive({ authProvider: 'password', ...auth }, {});
    return true;
  }

  // --- Prepare / authorize / revoke ---

  async function prepare() {
    if (drive) {
      if (authProvider !== 'password') return refresh();
      // Test connection for password-based services
      setSyncState({ status: SYNC_INITIALIZING });
      try {
        // Use list() to verify credentials work
        const batches = drive.list('');
        // eslint-disable-next-line no-unused-vars
        for await (const batch of batches) {
          break; // Just need first batch to verify connection
        }
        setSyncState({ status: SYNC_AUTHORIZED });
      } catch (err) {
        logError(err);
        setSyncState({ status: SYNC_UNAUTHORIZED });
      }
      return;
    }
    setSyncState({ status: SYNC_UNAUTHORIZED });
  }

  async function doAuthorize() {
    setSyncState({ status: SYNC_AUTHORIZING });
    try {
      const url = await authorizer.buildAuthUrl();
      const redirectUrl = await openAuthPage(url, providerConfig.redirect_uri);
      if (!redirectUrl) throw new Error('Authorization timed out');
      await authorizer.finishAuth(new URL(redirectUrl));
      setSyncState({ status: SYNC_AUTHORIZED });
      autoSync();
    } catch (err) {
      setSyncState({ status: SYNC_ERROR_AUTH });
      logError(err);
    }
  }

  function doRevoke() {
    if (authorizer) {
      authorizer.setAccessToken(null);
      authorizer.setRefreshToken(null);
    }
    serviceConfig.set({ token: null, refresh_token: null });
    prepare();
  }

  // --- Drive operations ---

  function get(item) {
    return drive.get({ id: item.id, path: item.name }).then((b) => b.text());
  }

  function put(item, data) {
    const blob = new Blob([data], { type: 'text/plain' });
    return drive.put({ id: item.id, path: item.name }, blob).then(normalize);
  }

  function remove(item) {
    return drive.remove({ id: item.id, path: item.name });
  }

  function normalize(item) {
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      uri: getURI(item.name),
    };
  }

  // --- Unified sync data ---

  async function getSyncData() {
    const files = [];
    for await (const batch of drive.list()) {
      files.push(...batch);
    }
    let metaFileItem;
    const scripts = [];
    for (const file of files) {
      if (file.name === metaFile) metaFileItem = file;
      else if (isScriptFile(file.name)) scripts.push(normalize(file));
    }
    const metaItem = metaFileItem ? { path: metaFileItem.name } : {};
    const gotMeta = drive
      .get(metaItem)
      .then((blob) => blob.text())
      .then((data) => JSON.parse(data))
      .catch((err) => (metaErrorFn || defaultMetaError)(err))
      .then((data) => ({ name: metaFile, uri: null, data }));
    return Promise.all([gotMeta, scripts, pluginScript.list()]);
  }

  function defaultMetaError(res) {
    if (res?.status !== 409) throw res;
  }

  // --- Sync algorithm ---

  async function _sync() {
    const currentSyncMode = syncMode;
    syncMode = SYNC_MERGE;
    progress = { finished: 0, total: 0 };

    const [remoteMeta, remoteData, localData] = await getSyncData();
    const remoteMetaData = remoteMeta.data || {};
    const remoteMetaInfo = remoteMetaData.info || {};
    const remoteTimestamp = remoteMetaData.timestamp || 0;
    let remoteChanged =
      !remoteTimestamp ||
      Object.keys(remoteMetaInfo).length !== remoteData.length;
    const now = Date.now();
    const globalLastModified = getOption('lastModified');
    const remoteItemMap = {};
    const localMeta = serviceConfig.get('meta', {});

    // Build snapshots for @usync/sync
    const localSnapshot = {
      metadata: { lastModified: localMeta.timestamp || 0 },
      items: {},
    };
    const remoteSnapshot = {
      metadata: { lastModified: remoteTimestamp },
      items: {},
    };

    localData.forEach((item) => {
      localSnapshot.items[item.props.uri] = {
        lastModified: item.props.lastModified || 0,
      };
    });
    remoteData.forEach((item) => {
      remoteItemMap[item.uri] = item;
      const info = remoteMetaInfo[item.uri] || {};
      remoteSnapshot.items[item.uri] = {
        lastModified: info.modified || now,
      };
    });

    // Content sync via @usync/sync
    const modeName =
      currentSyncMode === SYNC_PUSH
        ? 'push'
        : currentSyncMode === SYNC_PULL
          ? 'pull'
          : 'merge';
    const syncActions = getSyncActions(localSnapshot, remoteSnapshot, modeName);

    // Map actions to execution queues
    const putLocal = [];
    const putRemote = [];
    const delRemote = [];
    const delLocal = [];
    for (const { side, type, key } of syncActions) {
      if (side === 'right') {
        if (type === 'put') {
          const local = localData.find((i) => i.props.uri === key);
          putRemote.push({ local, remote: remoteItemMap[key] });
          remoteMetaInfo[key] = {
            ...(remoteMetaInfo[key] || {}),
            modified: local?.props.lastModified,
          };
          remoteChanged = true;
        } else {
          delRemote.push({ remote: remoteItemMap[key] });
          delete remoteMetaInfo[key];
          remoteChanged = true;
        }
      } else {
        if (type === 'put') {
          putLocal.push({
            remote: remoteItemMap[key],
            info: remoteMetaInfo[key] || {},
          });
        } else {
          delLocal.push({ local: localData.find((i) => i.props.uri === key) });
        }
      }
    }

    // Position and enabled post-processing
    const updateLocal = [];
    localData.forEach((item) => {
      const info = remoteMetaInfo[item.props.uri];
      if (info && info.modified === item.props.lastModified) {
        const updates = {};
        if (info.position !== item.props.position) {
          if (globalLastModified <= remoteTimestamp) {
            updates.props = { position: info.position };
          } else {
            info.position = item.props.position;
            remoteChanged = true;
          }
        }
        if (updates.props) {
          updateLocal.push({ local: item, updates });
        }
      }
    });

    const enableSync = getOption('syncScriptStatus');

    // Ensure all remote items have metadata
    remoteData.forEach((item) => {
      let info = remoteMetaInfo[item.uri];
      if (!info) {
        info = {};
        remoteMetaInfo[item.uri] = info;
      }
      if (!info.modified) {
        info.modified = now;
        remoteChanged = true;
      }
      if (enableSync) {
        const local = localData.find((i) => i.props.uri === item.uri);
        const localEnabled = local?.config.enabled ?? 1;
        if (localEnabled !== info.enabled) {
          info.enabled = localEnabled;
          remoteChanged = true;
        }
      }
    });

    const promiseQueue = [
      ...putLocal.map(({ remote, info }) => {
        logInfo('Download script:', remote.uri);
        return get(remote).then((raw) => {
          const data = parseScriptData(raw);
          if (!data.code) return;
          if (info.modified)
            objectSet(data, 'props.lastModified', info.modified);
          const position = +info.position;
          if (position) data.position = position;
          if (enableSync) {
            if (info.enabled != null)
              objectSet(data, 'config.enabled', info.enabled);
          }
          return pluginScript.update(data);
        });
      }),
      ...putRemote.map(({ local, remote }) => {
        logInfo('Upload script:', local.props.uri);
        return pluginScript.get(local.props.id).then((code) => {
          const data = getScriptData(local, { code });
          remoteMetaData.info[local.props.uri] = {
            modified: local.props.lastModified,
            position: local.props.position,
            ...(enableSync && {
              enabled: local.config.enabled,
            }),
          };
          remoteChanged = true;
          return put(
            Object.assign({}, remote, {
              uri: local.props.uri,
              name: null,
            }),
            JSON.stringify(data),
          );
        });
      }),
      ...delRemote.map(({ remote }) => {
        logInfo('Remove remote script:', remote.uri);
        delete remoteMetaData.info[remote.uri];
        remoteChanged = true;
        return remove(remote);
      }),
      ...delLocal.map(({ local }) => {
        logInfo('Remove local script:', local.props.uri);
        return pluginScript.remove(local.props.id);
      }),
      ...updateLocal.map(({ local, updates }) => {
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
          promises.push(put(remoteMeta, JSON.stringify(remoteMetaData)));
        }
        localMeta.timestamp = remoteMetaData.timestamp;
        localMeta.lastSync = Date.now();
        serviceConfig.set('meta', localMeta);
        return Promise.all(promises);
      }),
    );
    return Promise.all(
      promiseQueue.map((promise) => promise.then(noop, (err) => err || true)),
    )
      .then((errors) => errors.filter(Boolean))
      .then((errors) => {
        if (errors.length) throw errors;
      });
  }

  // --- Entry point ---

  async function doSync() {
    try {
      await prepare();
    } catch {
      // Sync in progress, ignore
    }
    if (getSyncState().status !== SYNC_AUTHORIZED || getCurrent() !== name)
      return;
    setSyncState({ status: SYNC_IN_PROGRESS });
    try {
      await _sync();
      logInfo('Sync finished:', displayName);
    } catch (err) {
      setSyncState({ status: SYNC_ERROR });
      logInfo('Failed syncing:', displayName);
      logError(err);
      throw err;
    }
    setSyncState({ status: SYNC_AUTHORIZED });
  }

  // --- Initialize ---

  function doInitialize() {
    serviceConfig = createServiceConfig(name);
    const token = serviceConfig.get('token');
    const refreshToken = serviceConfig.get('refresh_token');

    if (authProvider !== 'password') {
      const Authorizer = OAuth2Authorizers[authProvider];
      authorizer = new Authorizer(
        {
          clientId: providerConfig.client_id,
          clientSecret: providerConfig.client_secret || '',
          redirectUrl: providerConfig.redirect_uri,
          scope: providerConfig.scope,
          provider: providerConfig.provider,
          onSetAccessToken: (value) => {
            serviceConfig.set('token', value);
          },
          onSetRefreshToken: (value) => {
            serviceConfig.set('refresh_token', value);
          },
        },
        {
          accessToken: token || undefined,
          refreshToken: refreshToken || undefined,
        },
      );
      const Drive = DriveProviders[driveProvider];
      drive = new Drive({ authProvider, user: '' }, { authorizer });
    } else {
      initPassword();
    }

    return true;
  }

  // --- User config (for WebDAV/S3) ---

  const defaultUserConfig = {};
  let userConfigCache;

  function getUserConfig() {
    if (getUserConfigFn) {
      return (userConfigCache ||= {
        ...defaultUserConfig,
        ...serviceConfig.get(USER_CONFIG),
      });
    }
    return {};
  }

  function setUserConfig(cfg) {
    if (setUserConfigFn) {
      Object.assign(userConfigCache || {}, cfg);
      serviceConfig.set(USER_CONFIG, userConfigCache);
    }
  }

  // --- Public API ---

  return {
    name,
    displayName,
    get config() {
      return serviceConfig;
    },
    get progress() {
      return progress;
    },
    get error() {
      return error;
    },
    get properties() {
      return {
        authType: authProvider === 'password' ? 'password' : 'oauth',
        ...extraProperties,
      };
    },
    get hasAuth() {
      if (authProvider === 'password') {
        const c = getUserConfig();
        return !!(c && Object.values(c).some(Boolean));
      }
      return !!serviceConfig.get('token');
    },
    initialize: doInitialize,
    sync: doSync,
    authorize: doAuthorize,
    revoke: doRevoke,
    prepare,
    get,
    put,
    remove,
    getUserConfig,
    setUserConfig,
  };
}

// --- Service registry ---

export function register(service) {
  serviceClasses.push(service);
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
    serviceClasses.forEach((service) => {
      service.initialize();
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
    service?.prepare();
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

export function setConfig(cfg) {
  const service = getService();
  if (service) {
    service.setUserConfig(cfg);
    return autoSync();
  }
}
