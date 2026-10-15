import { debounce, keepAlive, noop, normalizeKeys } from '@/common';
import { kMainFrame, TIMEOUT_HOUR } from '@/common/consts';
import {
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
  USER_CONFIG,
} from '@/common/consts-sync';
import { forEachEntry, objectSet } from '@/common/object';
import { getScriptData, parseScriptData, serializeScriptData } from './script-format';
import { getItemFilename, getURI } from './remote-name';
import { getOption, setOption } from '../utils';
import broadcast from '../utils/broadcast';
import { sortScripts, updateScriptInfo } from '../utils/db';
import { DNR_ID_IDENTITY, updateSessionRules } from '../utils/dnr';
import { getNameURI, parseMeta } from '../utils/script';
import { script as pluginScript } from '../plugin';
import { parseXml } from '@violentmonkey/xml-parser';
import sessionData from '../utils/session-data';
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
  SYNC_ERROR_REPO_NOT_FOUND,
  SYNC_IN_PROGRESS,
  SYNC_INITIALIZING,
  SYNC_UNAUTHORIZED,
} from './state-machine';
import { formatDate } from '@/common/date';
import { getSyncActions } from '@usync/sync';
import {
  OAUTH2_NEED_REFRESH,
  OAUTH2_UNAUTHORIZED,
  OAuth2Authorizers,
} from '@usync/oauth2';
import {
  Dropbox,
  GithubContents,
  GoogleDrive,
  OneDrive,
  RepoNotFoundError,
  S3,
  WebDav,
} from '@usync/drive';

// @usync/drive only exports a `connectDrive(config, { providers })` factory
// plus the individual provider classes — not an aggregate map — because its
// own internal `builtinProviders` is intentionally unexported (extra
// providers like `git` register through `options.providers` instead). We
// don't use `connectDrive` here since this file already does its own
// OAuth2Authorizer wiring below, so rebuild the lookup map ourselves.
const DriveProviders = {
  googledrive: GoogleDrive,
  dropbox: Dropbox,
  onedrive: OneDrive,
  s3: S3,
  webdav: WebDav,
  'github-contents': GithubContents,
};

// --- Module-level state ---

const serviceNames = [];
const serviceClasses = [];
const services = {};
const syncLater = !__.MV3 && debounce(autoSync, TIMEOUT_HOUR);
// Some servers encode DAV:displayname unexpectedly (e.g. `vm%40` for `vm@`),
// so post-process the parsed XML to decode such displaynames.
const xmlParser = { parse: str => postProcessXml(parseXml(str, { removeNSPrefix: true }).node) };

function postProcessXml(node) {
  if (Array.isArray(node)) {
    node.forEach(postProcessXml);
  } else if (isObject(node)) {
    node::forEachEntry(([key, value]) => {
      if (key === 'displayname' && typeof value === 'string' && value.startsWith('vm%40')) {
        try {
          node[key] = decodeURIComponent(value);
        } catch {
          // Keep the original value
        }
      } else {
        postProcessXml(value);
      }
    });
  }
  return node;
}
const getDrive = (provider, opts, ctx) => new DriveProviders[provider](opts, { ...ctx, xmlParser });
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

function isSameRecorded(a, b) {
  const other = Array.isArray(b) ? b : [];
  return a.length === other.length
    && a.every((uri, i) => uri === other[i]);
}

// --- Public exports ---

export function setSyncOnceMode(mode) {
  syncMode = mode;
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

// --- State change listener ---

const onStateChange = debounce(() => {
  broadcast('UpdateSync', getStates());
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
        types: [kMainFrame, 'xmlhttprequest'],
      },
      ['blocking'],
    );
  });
  return promise;
}

export async function openAuthPageMV3(url, redirectUri) {
  try {
    await updateSessionRules(
      DNR_ID_IDENTITY,
      {
        urlFilter: '|' + redirectUri,
        resourceTypes: ['main_frame', 'xmlhttprequest'],
      },
      {
        type: 'redirect',
        redirect: {
          transform: {
            host: chrome.identity.getRedirectURL().split('/')[2],
            port: '',
            scheme: 'https',
          },
        },
      },
    );
    return await chrome.identity.launchWebAuthFlow({ interactive: true, url });
  } finally {
    await updateSessionRules([DNR_ID_IDENTITY]);
  }
}

// --- createSyncService factory ---

export function createSyncService({
  name,
  displayName,
  driveProvider,
  authProvider,
  metaFile = VIOLENTMONKEY,
  config: providerConfig,
  mapPasswordAuth,
  defaultUserConfig = {},
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
        if (err.code === OAUTH2_NEED_REFRESH) {
          await authorizer.refreshToken();
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err.code === OAUTH2_UNAUTHORIZED) {
        setSyncState({ status: SYNC_UNAUTHORIZED });
      } else {
        setSyncState({ status: SYNC_ERROR_INIT });
      }
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
    drive = getDrive(driveProvider, { authProvider: 'password', ...auth }, {});
    return true;
  }

  // --- Prepare / authorize / revoke ---

  async function prepare() {
    if (authProvider !== 'password') {
      if (drive) return refresh();
      setSyncState({ status: SYNC_UNAUTHORIZED });
      return;
    }
    // Reinitialize password drive to pick up credential changes
    if (!initPassword()) {
      setSyncState({ status: SYNC_UNAUTHORIZED });
      return;
    }
    setSyncState({ status: SYNC_INITIALIZING });
    progress.total += 1;
    let prepareError;
    try {
      const batches = drive.list();
      // eslint-disable-next-line no-unused-vars
      for await (const batch of batches) {
        break;
      }
    } catch (err) {
      if ((err.response?.status) === 404 && driveProvider === 'webdav') {
        await drive.mkdir(VIOLENTMONKEY);
      } else {
        prepareError = err;
      }
    }
    if (prepareError) {
      logError(prepareError);
      // Thrown when the repo/project itself doesn't exist or isn't
      // accessible to the token, distinct from a merely-empty path.
      setSyncState({
        status:
          prepareError instanceof RepoNotFoundError
            ? SYNC_ERROR_REPO_NOT_FOUND
            : SYNC_UNAUTHORIZED,
      });
    } else {
      setSyncState({ status: SYNC_AUTHORIZED });
    }
    progress.finished += 1;
  }

  async function doAuthorize() {
    setSyncState({ status: SYNC_AUTHORIZING });
    try {
      const url = await authorizer.buildAuthUrl();
      const redirectUrl = await (__.MV3 ? openAuthPageMV3 : openAuthPage)(
        url,
        providerConfig.redirect_uri,
      );
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
    prepare().catch(noop);
  }

  // --- Drive operations ---

  function createQueue() {
    let chain = Promise.resolve();
    return (fn) => {
      progress.total += 1;
      onStateChange();
      const result = chain.then(fn);
      chain = result.catch(noop).then(() => {
        progress.finished += 1;
        onStateChange();
      });
      if (__.MV3) keepAlive(chain);
      return result;
    };
  }
  const enqueue = createQueue();

  function get(item) {
    return enqueue(() => drive.get({ id: item.id }).then((b) => b.text()));
  }

  function put(item, data, scriptName) {
    const blob = new Blob([data], { type: 'text/plain' });
    // A new file needs a name; the meta always keeps its own.
    const fileName = item.name || getItemFilename(scriptName, item.uri);
    return enqueue(async () => {
      const res = await drive.put(
        item.id ? { id: item.id } : { parent: {}, name: fileName },
        blob,
      );
      return normalize(res, item.uri);
    });
  }

  function remove(item) {
    return enqueue(() => drive.remove({ id: item.id }));
  }

  function normalize(item, uri = getURI(item.name)) {
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      uri,
    };
  }

  // --- Remote manifest ---

  // A script is identified by its content, not by its file name. The meta records
  // the name each uri was last seen under, so recognizing our own files is free.
  const MAX_UNTRACKED_READS = 5;

  /**
   * Resolve every listed file to the script it holds, then pick one file per
   * script. Returns the manifest entries, and the uris that have duplicates.
   */
  async function gatherManifest(files, info) {
    const byName = new Map();
    for (const [uri, item] of Object.entries(info)) {
      if (item.filename) byName.set(item.filename, uri);
    }
    /** @type {Map<string, Object[]>} uri -> every file that holds it */
    const found = new Map();
    const add = (uri, file, isRecorded) => {
      let group = found.get(uri);
      if (!group) found.set(uri, group = []);
      group.push({ ...file, isRecorded });
    };
    const untracked = [];
    for (const file of files) {
      // A folder is never a script; OneDrive labels them as files, so there they
      // still cost a read and a warning.
      if (file.kind === 'folder') continue;
      // Anything else that isn't the meta may be a script, whatever it's named:
      // a user may rename or add files, and vm3 names carry no uri.
      if (file.name === metaFile) continue;
      const recorded = byName.get(file.name);
      const uri = recorded || getURI(file.name);
      if (uri) add(uri, file, !!recorded);
      else untracked.push(file);
    }
    // Reading a file is a request, so resolve a few untracked ones per sync and
    // let the next one continue where this left off.
    for (const file of untracked.slice(0, MAX_UNTRACKED_READS)) {
      const uri = await readURI(file);
      if (uri) {
        logInfo('Adopted remote file:', file.name, 'as', uri);
        add(uri, file, false);
      }
    }
    const scripts = [];
    /** @type {Set<string>} uris that have more than one file */
    const extras = new Set();
    for (const [uri, group] of found) {
      // The name the meta points at wins, else the lowest id, so every client
      // picks the same file. The listing's timestamps would tie-break better, but
      // they come from the server and some providers omit them.
      group.sort((a, b) => Number(b.isRecorded) - Number(a.isRecorded)
        || String(a.id).localeCompare(String(b.id)));
      const [winner, ...losers] = group;
      scripts.push(normalize(winner, uri));
      if (losers.length) extras.add(uri);
    }
    return { scripts, extras };
  }

  /** @return {?string} the uri of the script a remote file holds */
  async function readURI(file) {
    const raw = await get(file).catch((err) => {
      logWarn('Failed to read remote file:', file.name, err);
    });
    if (!raw) return null;
    let meta;
    try {
      meta = parseMeta(parseScriptData(raw).code);
    } catch (err) {
      logWarn('Failed to parse remote file:', file.name, err);
    }
    // A nameless script would collapse onto the same uri as every other nameless
    // one, so leave it rather than merge them.
    return meta && meta.name ? getNameURI({ meta }) : null;
  }

  // --- Unified sync data ---

  async function getSyncData() {
    const files = [];
    const batches = drive.list();
    progress.total += 1;
    for await (const batch of batches) {
      files.push(...batch);
    }
    progress.finished += 1;
    // Counts, not names: the listing can hold hundreds of files.
    const metaListed = files.some((f) => f.name === metaFile);
    logInfo('Remote files:', files.length, 'meta found:', metaListed);
    let metadata;
    try {
      // Read the meta by its known name, not by the name the listing reports: a
      // server may return a `DAV:displayname` that differs from the actual file
      // name, and then the meta is silently skipped, so every item falls back to
      // `now` and each sync re-downloads everything and reverts every deletion.
      const blob = await enqueue(() => drive.get({ path: metaFile }));
      const text = await blob.text();
      metadata = JSON.parse(text);
    } catch (err) {
      // A missing meta is normal on a fresh remote; anything else means we sync
      // against nothing without saying so.
      if (err.response?.status !== 404) {
        logWarn('Failed to read meta file:', err);
      }
    }
    const info = metadata?.info || {};
    const { scripts, extras } = await gatherManifest(files, info);
    // Convert VM file format to snapshot format and mark stale entries as tombstones
    const scriptSet = new Set(scripts.map((s) => s.uri));
    for (const [uri, item] of Object.entries(info)) {
      item.lastModified = item.modified || 0;
      delete item.modified;
      if (!item.deleted && !scriptSet.has(uri)) {
        item.deleted = true;
        item.lastModified = Date.now();
      }
    }
    // Remember the name each uri is stored under, so recognizing it next time is
    // free. A duplicate is only ever ignored, never removed.
    let renamed = false;
    for (const script of scripts) {
      const item = info[script.uri] ||= {};
      if (item.deleted) continue;
      if (item.filename !== script.name) {
        item.filename = script.name;
        renamed = true;
      }
    }
    // Record the uris that have duplicate files, so a later version can remove
    // them once every client is on the manifest. Nothing is removed here: a
    // pre-manifest client finds no file for the uri, marks the script deleted and
    // wipes it locally, so the format has to be flipped before a delete is safe.
    // Sorted so the same set always serializes the same way, whatever order the
    // listing arrived in. Only a changed set is written back, else the meta would
    // be rewritten on every sync for as long as the duplicates are there.
    const pendingDelete = [...extras].sort();
    if (!isSameRecorded(pendingDelete, metadata?.pendingDelete)) {
      renamed = true;
    }
    metadata = {
      metadata: { lastModified: metadata?.timestamp || 0 },
      items: info,
      pendingDelete,
      renamed,
    };
    const localScripts = await pluginScript.list();
    return [
      {
        name: metaFile,
        uri: null,
        data: metadata,
      },
      scripts,
      localScripts.filter((s) => !s.config.removed),
      localScripts.filter((s) => s.config.removed),
    ];
  }

  // --- Sync algorithm ---

  async function _sync() {
    const currentSyncMode = syncMode;
    syncMode = SYNC_MERGE;
    const isPull = currentSyncMode === SYNC_PULL;
    const isPush = currentSyncMode === SYNC_PUSH;
    progress = { finished: 0, total: 0 };

    const [remoteMeta, remoteData, localData, localRemoved] = await getSyncData();
    const remoteMetaData = remoteMeta.data || {};
    const items = remoteMetaData.items || {};
    const remoteLastModified = remoteMetaData.metadata?.lastModified || 0;
    const activeCount = Object.values(items).filter((i) => !i.deleted).length;
    let remoteChanged =
      !remoteLastModified || activeCount !== remoteData.length;
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
      metadata: { lastModified: remoteLastModified },
      items: {},
    };

    localData.forEach((item) => {
      localSnapshot.items[item.props.uri] = {
        lastModified: item.props.lastModified || 0,
      };
    });
    // Add tombstones for locally deleted scripts
    localRemoved.forEach((item) => {
      const uri = item.props.uri;
      if (!localSnapshot.items[uri]) {
        localSnapshot.items[uri] = {
          lastModified: item.props.lastModified || 0,
          deleted: true,
        };
      }
    });
    // Include active items from remoteData with metadata
    for (const item of remoteData) {
      remoteItemMap[item.uri] = item;
      const info = items[item.uri] || {};
      remoteSnapshot.items[item.uri] = {
        lastModified: info.lastModified || now,
      };
    }
    // Include tombstones (no corresponding file)
    for (const [uri, info] of Object.entries(items)) {
      if (info.deleted && !remoteItemMap[uri]) {
        remoteSnapshot.items[uri] = {
          lastModified: info.lastModified || 0,
          deleted: true,
        };
      }
    }

    // Content sync via @usync/sync
    logInfo(
      `Meta: local=${localMeta.timestamp ?? '-'}`
      + ` remote=${remoteMetaData.metadata?.lastModified ?? '-'}`,
    );
    const logAction = (action, uri) => logInfo(
      `${action}: local=${localSnapshot.items[uri]?.lastModified ?? '-'}`
      + ` remote=${remoteSnapshot.items[uri]?.lastModified ?? '-'}`
      + ` uri=${uri}`,
    );
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
          items[key] = {
            ...(items[key] || {}),
            lastModified: local?.props.lastModified,
          };
          remoteChanged = true;
        } else {
          delRemote.push({ remote: remoteItemMap[key] });
          items[key] = { deleted: true, lastModified: now };
          remoteChanged = true;
        }
      } else {
        if (type === 'put') {
          putLocal.push({
            remote: remoteItemMap[key],
            info: items[key] || {},
          });
        } else {
          delLocal.push({ local: localData.find((i) => i.props.uri === key) });
        }
      }
    }

    // Position post-processing
    const updateLocal = [];
    localData.forEach((item) => {
      const info = items[item.props.uri];
      if (info && info.lastModified === item.props.lastModified) {
        const updates = {};
        if (info.position !== item.props.position) {
          if (globalLastModified <= remoteLastModified || isPull) {
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
      let info = items[item.uri];
      if (!info) {
        info = {};
        items[item.uri] = info;
      }
      if (!info.lastModified) {
        info.lastModified = now;
        remoteChanged = true;
      }
    });

    // Merge `config.enabled` like `position` above: last syncer wins by comparing
    // the global `lastModified` clock (bumped on toggles) with the remote meta
    // timestamp. Unlike `position` there's no content gate since a toggle bumps
    // `props.lastModified`, which would otherwise always skip the merge.
    // NOTE: the clock is global, so toggles of different scripts on different
    // devices can overwrite each other, and a toggle also tilts `position` local.
    if (enableSync) {
      const deletedUris = new Set([
        ...delRemote.map(({ remote }) => remote.uri),
        ...delLocal.map(({ local }) => local.props.uri),
      ]);
      const localByUri = new Map(localData.map((item) => [item.props.uri, item]));
      for (const [uri, local] of localByUri) {
        const info = items[uri];
        if (!info || !remoteItemMap[uri] || deletedUris.has(uri)) continue;
        const localEnabled = local.config.enabled ?? 1;
        if (info.enabled == null) {
          // No remote opinion yet, initialize from local.
          if (!isPull) {
            info.enabled = localEnabled;
            remoteChanged = true;
          }
          continue;
        }
        if (localEnabled === info.enabled) continue;
        if (isPull || (!isPush && globalLastModified <= remoteLastModified)) {
          updateLocal.push({
            local,
            updates: {
              config: { enabled: info.enabled },
            },
          });
        } else {
          info.enabled = localEnabled;
          remoteChanged = true;
        }
      }
    }

    const promiseQueue = [
      ...putLocal.map(({ remote, info }) => {
        logAction('Download script', remote.uri);
        return get(remote).then((raw) => {
          const data = parseScriptData(raw);
          if (!data.code) return;
          if (info.lastModified)
            objectSet(data, 'props.lastModified', info.lastModified);
          const position = +info.position;
          if (position) data.position = position;
          if (enableSync && info.enabled != null) {
            objectSet(data, 'config.enabled', info.enabled);
          }
          return pluginScript.update(data);
        });
      }),
      ...putRemote.map(({ local, remote }) => {
        logAction('Upload script', local.props.uri);
        return pluginScript.get(local.props.id).then((code) => {
          const data = getScriptData(local, { code });
          items[local.props.uri] = {
            lastModified: local.props.lastModified,
            position: local.props.position,
            ...(enableSync && {
              enabled: local.config.enabled,
            }),
          };
          remoteChanged = true;
          return put(
            // Overwritten by id, so an existing file keeps the name the meta
            // recorded; a new one is named here, then recorded below.
            Object.assign({}, remote, { uri: local.props.uri, name: null }),
            serializeScriptData(data),
            local.meta.name,
          ).then((saved) => {
            const info = items[local.props.uri];
            if (info && saved.name) info.filename = saved.name;
          });
        });
      }),
      ...delRemote.map(({ remote }) => {
        logAction('Remove remote script', remote.uri);
        items[remote.uri] = { deleted: true, lastModified: now };
        remoteChanged = true;
        return remove(remote);
      }),
      ...delLocal.map(({ local }) => {
        logAction('Remove local script', local.props.uri);
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
              const remoteInfo = items[script.props.uri];
              if (remoteInfo) remoteInfo.position = script.props.position;
            });
          });
        }),
    );
    promiseQueue.push(
      Promise.all(promiseQueue).then(() => {
        const promises = [];
        // Clean up old tombstones
        const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
        for (const [uri, info] of Object.entries(items)) {
          if (
            info.deleted &&
            info.lastModified &&
            now - info.lastModified > ONE_YEAR
          ) {
            delete items[uri];
            remoteChanged = true;
          }
        }
        const { renamed, pendingDelete } = remoteMetaData;
        if (renamed) remoteChanged = true;
        if (remoteChanged && !isPull) {
          const timestamp = Date.now();
          remoteMetaData.metadata.lastModified = timestamp;
          // Convert back to VM file format
          const fileData = { timestamp, info: {} };
          for (const [uri, item] of Object.entries(items)) {
            fileData.info[uri] = {
              modified: item.lastModified,
              ...item,
              lastModified: undefined,
            };
          }
          if (pendingDelete?.length) fileData.pendingDelete = pendingDelete;
          promises.push(put(remoteMeta, JSON.stringify(fileData)));
        }
        localMeta.timestamp = remoteMetaData.metadata.lastModified;
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
      // Prepare failed (e.g. another sync in progress), abort
      return;
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
          clientSecret: providerConfig.client_secret,
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
      drive = getDrive(
        driveProvider,
        { authProvider, user: '' },
        { authorizer },
      );
    } else {
      initPassword();
    }

    return true;
  }

  // --- User config (for WebDAV/S3) ---

  let userConfigCache;

  function getUserConfig() {
    if (mapPasswordAuth) {
      return (userConfigCache ||= {
        ...defaultUserConfig,
        ...serviceConfig.get(USER_CONFIG),
      });
    }
    return {};
  }

  function setUserConfig(cfg) {
    if (mapPasswordAuth) {
      Object.assign(userConfigCache || {}, cfg);
      serviceConfig.set(USER_CONFIG, userConfigCache);
    }
  }

  // --- Public API ---

  return {
    name,
    displayName,
    get authorizer() {
      return authorizer;
    },
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

// Explicit entry points (startup, credential save): run a sync when auto-sync
// is on — which also kicks off the MV2 hourly chain — otherwise just refresh
// the status with a single request.
function syncOrRefresh() {
  if (getOption('syncAutomatically')) return sync();
  return getService()?.prepare().catch(noop);
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
  if (!__.MV3 || !sessionData.init) {
    syncOrRefresh();
  }
  return !!getService();
}

export function sync() {
  const service = getService();
  return __.MV3
    ? service?.sync()
    : service && Promise.resolve(service.sync()).then(syncLater);
}

export function autoSync() {
  // No-op when auto-sync is off: even `prepare()` hits the network
  // (e.g. PROPFIND on WebDAV), so storage changes and the hourly alarm
  // must not trigger any request in that case.
  if (!getOption('syncAutomatically')) return;
  return sync();
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
    return syncOrRefresh();
  }
}
