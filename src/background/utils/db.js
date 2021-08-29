import {
  compareVersion, i18n, getFullUrl, isRemote, sendCmd, trueJoin,
} from '#/common';
import {
  CMD_SCRIPT_ADD, CMD_SCRIPT_UPDATE, INJECT_PAGE, INJECT_AUTO, TIMEOUT_WEEK,
} from '#/common/consts';
import { forEachEntry, forEachKey, forEachValue } from '#/common/object';
import storage from '#/common/storage';
import ua from '#/common/ua';
import pluginEvents from '../plugin/events';
import { getNameURI, parseMeta, newScript, getDefaultCustom } from './script';
import { testScript, testBlacklist } from './tester';
import { preInitialize } from './init';
import { commands } from './message';
import patchDB from './patch-db';
import { setOption } from './options';
import './storage-fetch';
import dataCache from './cache';

const store = {};
storage.base.setDataCache(dataCache);
storage.script.onDump = (item) => {
  store.scriptMap[item.props.id] = item;
};

Object.assign(commands, {
  CheckPosition: sortScripts,
  CheckRemove: checkRemove,
  /** @return {VMScript} */
  GetScript: getScript,
  /** @return {Promise<{ items: VMScript[], values? }>} */
  async ExportZip({ values }) {
    const scripts = getScripts();
    const ids = scripts.map(getPropsId);
    const codeMap = await storage.code.getMulti(ids);
    return {
      items: scripts.map(script => ({ script, code: codeMap[script.props.id] })),
      values: values ? await storage.value.getMulti(ids) : undefined,
    };
  },
  /** @return {Promise<string>} */
  GetScriptCode(id) {
    return storage.code.getOne(id);
  },
  /** @return {Promise<void>} */
  MarkRemoved({ id, removed }) {
    return updateScriptInfo(id, {
      config: { removed: removed ? 1 : 0 },
      props: { lastModified: Date.now() },
    });
  },
  /** @return {Promise<number>} */
  Move({ id, offset }) {
    const script = getScriptById(id);
    const index = store.scripts.indexOf(script);
    store.scripts.splice(index, 1);
    store.scripts.splice(index + offset, 0, script);
    return normalizePosition();
  },
  /** @return {Promise<void>} */
  async RemoveScript(id) {
    const i = store.scripts.indexOf(getScriptById(id));
    if (i >= 0) {
      store.scripts.splice(i, 1);
      await Promise.all([
        storage.script.remove(id),
        storage.code.remove(id),
        storage.value.remove(id),
      ]);
    }
    return sendCmd('RemoveScript', id);
  },
  ParseMeta: parseMeta,
  ParseScript: parseScript,
  /** @return {Promise<void>} */
  UpdateScriptInfo({ id, config, custom }) {
    return updateScriptInfo(id, {
      config,
      custom,
      props: { lastModified: Date.now() },
    });
  },
  /** @return {Promise<void>} */
  Vacuum: vacuum,
});

preInitialize.push(async () => {
  const { version: lastVersion } = await browser.storage.local.get('version');
  const version = process.env.VM_VER;
  if (!lastVersion) await patchDB();
  if (version !== lastVersion) browser.storage.local.set({ version });
  const data = await browser.storage.local.get();
  const scripts = [];
  const storeInfo = {
    id: 0,
    position: 0,
  };
  const idMap = {};
  const uriMap = {};
  const mods = [];
  const resUrls = [];
  /** @this VMScriptCustom.pathMap */
  const rememberUrl = function _(url) { resUrls.push(this[url] || url); };
  data::forEachEntry(([key, script]) => {
    dataCache.put(key, script);
    if (key.startsWith(storage.script.prefix)) {
      // {
      //   meta,
      //   custom,
      //   props: { id, position, uri },
      //   config: { enabled, shouldUpdate },
      // }
      const id = getInt(key.slice(storage.script.prefix.length));
      if (!id || idMap[id]) {
        // ID conflicts!
        // Should not happen, discard duplicates.
        return;
      }
      idMap[id] = script;
      const uri = getNameURI(script);
      if (uriMap[uri]) {
        // Namespace conflicts!
        // Should not happen, discard duplicates.
        return;
      }
      uriMap[uri] = script;
      script.props = {
        ...script.props,
        id,
        uri,
      };
      script.custom = {
        ...getDefaultCustom(),
        ...script.custom,
      };
      storeInfo.id = Math.max(storeInfo.id, id);
      storeInfo.position = Math.max(storeInfo.position, getInt(script.props.position));
      scripts.push(script);
      // listing all known resource urls in order to remove unused mod keys
      const {
        custom: { pathMap = {} } = {},
        meta = {},
      } = script;
      meta.grant = [...new Set(meta.grant || [])]; // deduplicate
      meta.require?.forEach(rememberUrl, pathMap);
      Object.values(meta.resources || {}).forEach(rememberUrl, pathMap);
      pathMap::rememberUrl(meta.icon);
    } else if (key.startsWith(storage.mod.prefix)) {
      mods.push(key.slice(storage.mod.prefix.length));
    }
  });
  storage.mod.removeMulti(mods.filter(url => !resUrls.includes(url)));
  Object.assign(store, {
    scripts,
    storeInfo,
    scriptMap: scripts.reduce((map, item) => {
      map[item.props.id] = item;
      return map;
    }, {}),
  });
  // Switch defaultInjectInto from `page` to `auto` when upgrading VM2.12.7 or older
  if (version !== lastVersion
  && ua.isFirefox
  && data.options?.defaultInjectInto === INJECT_PAGE
  && compareVersion(lastVersion, '2.12.7') <= 0) {
    setOption('defaultInjectInto', INJECT_AUTO);
  }
  if (process.env.DEBUG) {
    console.log('store:', store); // eslint-disable-line no-console
  }
  return sortScripts();
});

/** @return {number} */
function getInt(val) {
  return +val || 0;
}

/** @return {?number} */
function getPropsId(script) {
  return script?.props.id;
}

/** @return {void} */
function updateLastModified() {
  setOption('lastModified', Date.now());
}

/** @return {Promise<number>} */
export async function normalizePosition() {
  const updates = store.scripts.filter(({ props }, index) => {
    const position = index + 1;
    const res = props.position !== position;
    if (res) props.position = position;
    return res;
  });
  store.storeInfo.position = store.scripts.length;
  if (updates.length) {
    await storage.script.dump(updates);
    updateLastModified();
  }
  return updates.length;
}

/** @return {Promise<number>} */
export async function sortScripts() {
  store.scripts.sort((a, b) => getInt(a.props.position) - getInt(b.props.position));
  const changed = await normalizePosition();
  sendCmd('ScriptsUpdated', null);
  return changed;
}

/** @return {?VMScript} */
export function getScriptById(id) {
  return store.scriptMap[id];
}

/** @return {?VMScript} */
export function getScript({ id, uri, meta }) {
  let script;
  if (id) {
    script = getScriptById(id);
  } else {
    if (!uri) uri = getNameURI({ meta, id: '@@should-have-name' });
    script = store.scripts.find(({ props }) => uri === props.uri);
  }
  return script;
}

/** @return {VMScript[]} */
export function getScripts() {
  return store.scripts.filter(script => !script.config.removed);
}

/**
 * @desc Load values for batch updates.
 * @param {number[]} ids
 * @return {Promise<Object>}
 */
export function getValueStoresByIds(ids) {
  return storage.value.getMulti(ids);
}

/**
 * @desc Dump values for batch updates.
 * @param {Object} valueDict { id1: value1, id2: value2, ... }
 * @return {Promise<Object>}
 */
export async function dumpValueStores(valueDict) {
  if (process.env.DEBUG) console.info('Update value stores', valueDict);
  await storage.value.dump(valueDict);
  return valueDict;
}

export const ENV_CACHE_KEYS = 'cacheKeys';
export const ENV_REQ_KEYS = 'reqKeys';
export const ENV_VALUE_IDS = 'valueIds';
const GMVALUES_RE = /^GM[_.](listValues|([gs]et|delete)Value)$/;
const RUN_AT_RE = /^document-(start|body|end|idle)$/;
/**
 * @desc Get scripts to be injected to page with specific URL.
 */
export async function getScriptsByURL(url, isTop) {
  const allScripts = testBlacklist(url)
    ? []
    : store.scripts.filter(script => (
      !script.config.removed
      && (isTop || !(script.custom.noframes ?? script.meta.noframes))
      && testScript(url, script)
    ));
  const disabledIds = [];
  /** @namespace VMScriptByUrlData */
  const [envStart, envDelayed] = [0, 1].map(() => ({
    ids: [],
    /** @type {VMInjectedScript[]} */
    scripts: [],
    [ENV_CACHE_KEYS]: [],
    [ENV_REQ_KEYS]: [],
    [ENV_VALUE_IDS]: [],
  }));
  allScripts.forEach((script) => {
    const { id } = script.props;
    if (!script.config.enabled) {
      disabledIds.push(id);
      return;
    }
    const { meta, custom } = script;
    const { pathMap = buildPathMap(script) } = custom;
    const runAt = `${custom.runAt || meta.runAt || ''}`.match(RUN_AT_RE)?.[1] || 'end';
    const env = runAt === 'start' || runAt === 'body' ? envStart : envDelayed;
    env.ids.push(id);
    if (meta.grant?.some(GMVALUES_RE.test, GMVALUES_RE)) {
      env[ENV_VALUE_IDS].push(id);
    }
    for (const [list, name] of [
      [meta.require, ENV_REQ_KEYS],
      [Object.values(meta.resources), ENV_CACHE_KEYS],
    ]) {
      list.forEach(key => {
        key = pathMap[key] || key;
        if (!envStart[name].includes(key)) {
          env[name].push(key);
        }
      });
    }
    /** @namespace VMInjectedScript */
    env.scripts.push({ ...script, runAt });
  });
  if (envDelayed.ids.length) {
    envDelayed.promise = readEnvironmentData(envDelayed);
  }
  /** @namespace VMScriptByUrlData */
  return {
    ...envStart,
    ...await readEnvironmentData(envStart),
    disabledIds,
    envDelayed,
  };
}

/**
 * Object keys == areas in `storage` module.
 * @namespace VMScriptByUrlData
 */
const STORAGE_ROUTES = Object.entries({
  cache: ENV_CACHE_KEYS,
  code: 'ids',
  require: ENV_REQ_KEYS,
  value: ENV_VALUE_IDS,
});

async function readEnvironmentData(env) {
  const keys = [];
  STORAGE_ROUTES.forEach(([area, srcIds]) => {
    env[srcIds].forEach(id => {
      keys.push(storage[area].getKey(id));
    });
  });
  const data = await storage.base.getMulti(keys);
  STORAGE_ROUTES.forEach(([area, srcIds]) => {
    env[area] = {};
    env[srcIds].forEach(id => {
      env[area][id] = data[storage[area].getKey(id)];
    });
  });
  return env;
}

/**
 * @desc Get data for dashboard.
 * @return {Promise<{ scripts: VMScript[], cache: Object }>}
 */
export async function getData(ids) {
  const scripts = ids ? ids.map(getScriptById) : store.scripts;
  return {
    scripts,
    cache: await getIconCache(scripts),
  };
}

function getIconCache(scripts) {
  const iconUrls = [];
  scripts.forEach((script) => {
    const { icon } = script.meta;
    if (isRemote(icon)) {
      iconUrls.push(script.custom.pathMap?.[icon] || icon);
    }
  });
  return iconUrls.length
    ? storage.cache.getMulti(iconUrls, undefined, storage.cache.makeDataUri)
    : {};
}

/** @return {number} */
export function checkRemove({ force } = {}) {
  const now = Date.now();
  const toRemove = store.scripts.filter(script => script.config.removed && (
    force || now - getInt(script.props.lastModified) > TIMEOUT_WEEK
  ));
  if (toRemove.length) {
    store.scripts = store.scripts.filter(script => !script.config.removed);
    const ids = toRemove.map(getPropsId);
    storage.script.removeMulti(ids);
    storage.code.removeMulti(ids);
    storage.value.removeMulti(ids);
  }
  return toRemove.length;
}

/** @return {string} */
function getUUID() {
  const rnd = new Uint16Array(8);
  window.crypto.getRandomValues(rnd);
  // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We're using UUIDv4 variant 1 so N=4 and M=8
  // See format_uuid_v3or5 in https://tools.ietf.org/rfc/rfc4122.txt
  rnd[3] = rnd[3] & 0x0FFF | 0x4000; // eslint-disable-line no-bitwise
  rnd[4] = rnd[4] & 0x3FFF | 0x8000; // eslint-disable-line no-bitwise
  return '01-2-3-4-567'.replace(/\d/g, i => (rnd[i] + 0x1_0000).toString(16).slice(-4));
}

/**
 * @param {VMScript} script
 * @param {string} code
 * @return {Promise<VMScript[]>}
 */
async function saveScript(script, code) {
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
  props.uuid = props.uuid || crypto.randomUUID?.() || getUUID();
  // Do not allow script with same name and namespace
  if (store.scripts.some(({ props: { id, uri } = {} }) => props.id !== id && props.uri === uri)) {
    throw i18n('msgNamespaceConflict');
  }
  if (oldScript) {
    script.config = { ...oldScript.config, ...config };
    script.props = { ...oldScript.props, ...props };
    const index = store.scripts.indexOf(oldScript);
    store.scripts[index] = script;
  } else {
    if (!props.position) {
      store.storeInfo.position += 1;
      props.position = store.storeInfo.position;
    } else if (store.storeInfo.position < props.position) {
      store.storeInfo.position = props.position;
    }
    script.config = config;
    script.props = props;
    store.scripts.push(script);
  }
  return Promise.all([
    storage.script.dump(script),
    storage.code.set(props.id, code),
  ]);
}

/** @return {Promise<void>} */
export async function updateScriptInfo(id, data) {
  const script = store.scriptMap[id];
  if (!script) throw null;
  script.props = { ...script.props, ...data.props };
  script.config = { ...script.config, ...data.config };
  script.custom = { ...script.custom, ...data.custom };
  await storage.script.dump(script);
  return sendCmd(CMD_SCRIPT_UPDATE, { where: { id }, update: script });
}

/** @return {Promise<{ isNew?, update, where }>} */
export async function parseScript(src) {
  const meta = parseMeta(src.code);
  if (!meta.name) throw i18n('msgInvalidScript');
  const result = {
    update: {
      message: src.message == null ? i18n('msgUpdated') : src.message || '',
    },
  };
  let cmd = CMD_SCRIPT_UPDATE;
  let script;
  const oldScript = await getScript({ id: src.id, meta });
  if (oldScript) {
    if (src.isNew) throw i18n('msgNamespaceConflict');
    script = { ...oldScript };
  } else {
    ({ script } = newScript());
    cmd = CMD_SCRIPT_ADD;
    result.isNew = true;
    result.update.message = i18n('msgInstalled');
  }
  script.config = {
    ...script.config,
    ...src.config,
    removed: 0, // force reset `removed` since this is an installation
  };
  script.custom = {
    ...script.custom,
    ...src.custom,
  };
  script.props = {
    ...script.props,
    lastModified: Date.now(),
    lastUpdated: Date.now(),
    ...src.props,
  };
  script.meta = meta;
  if (!meta.homepageURL && !script.custom.homepageURL && isRemote(src.from)) {
    script.custom.homepageURL = src.from;
  }
  if (isRemote(src.url)) script.custom.lastInstallURL = src.url;
  if (src.position) script.props.position = +src.position;
  buildPathMap(script, src.url);
  await saveScript(script, src.code);
  fetchResources(script, src);
  Object.assign(result.update, script, src.update);
  result.where = { id: script.props.id };
  sendCmd(cmd, result);
  pluginEvents.emit('scriptChanged', result);
  return result;
}

/** @return {Object} */
function buildPathMap(script, base) {
  const { meta } = script;
  const baseUrl = base || script.custom.lastInstallURL;
  const pathMap = baseUrl ? [
    ...meta.require,
    ...Object.values(meta.resources),
    meta.icon,
  ].reduce((map, key) => {
    if (key) {
      const fullUrl = getFullUrl(key, baseUrl);
      if (fullUrl !== key) map[key] = fullUrl;
    }
    return map;
  }, {}) : {};
  script.custom.pathMap = pathMap;
  return pathMap;
}

/** @return {Promise<?string>} resolves to error text if `resourceCache` is absent */
export async function fetchResources(script, resourceCache, reqOptions) {
  const { custom: { pathMap }, meta } = script;
  const snatch = (url, type, validator) => {
    url = pathMap[url] || url;
    const contents = resourceCache?.[type]?.[url];
    return contents != null && !validator
      ? storage[type].set(url, contents) && null
      : storage[type].fetch(url, reqOptions, validator).catch(err => err);
  };
  const errors = await Promise.all([
    ...meta.require.map(url => snatch(url, 'require')),
    ...Object.values(meta.resources).map(url => snatch(url, 'cache')),
    isRemote(meta.icon) && snatch(meta.icon, 'cache', validateImage),
  ]);
  if (!resourceCache) {
    const error = errors.map(formatHttpError)::trueJoin('\n');
    if (error) {
      const message = i18n('msgErrorFetchingResource');
      sendCmd(CMD_SCRIPT_UPDATE, {
        update: { error, message },
        where: { id: script.props.id },
      });
      return `${message}\n${error}`;
    }
  }
}

/** @return {Promise<void>} resolves on success, rejects on error */
function validateImage(url, buf, type) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([buf], { type }));
    const onDone = (e) => {
      URL.revokeObjectURL(blobUrl);
      if (e.type === 'load') resolve();
      else reject({ type: 'IMAGE_ERROR', url });
    };
    const image = new Image();
    image.onload = onDone;
    image.onerror = onDone;
    image.src = blobUrl;
  });
}

function formatHttpError(e) {
  return e && [e.status && `HTTP${e.status}`, e.url]::trueJoin(' ') || e;
}

/** @return {Promise<void>} */
export async function vacuum() {
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
  const data = await browser.storage.local.get();
  data::forEachKey((key) => {
    mappings.some(([substore, map]) => {
      const { prefix } = substore;
      if (key.startsWith(prefix)) {
        // -1 for untouched, 1 for touched, 2 for missing
        map[key.slice(prefix.length)] = -1;
        return true;
      }
      return false;
    });
  });
  const touch = (obj, key) => {
    if (obj[key] < 0) {
      obj[key] = 1;
    } else if (!obj[key]) {
      obj[key] = 2;
    }
  };
  store.scripts.forEach((script) => {
    const { id } = script.props;
    touch(codeKeys, id);
    touch(valueKeys, id);
    if (!script.custom.pathMap) buildPathMap(script);
    const { pathMap } = script.custom;
    script.meta.require.forEach((url) => {
      touch(requireKeys, pathMap[url] || url);
    });
    script.meta.resources::forEachValue((url) => {
      touch(cacheKeys, pathMap[url] || url);
    });
    const { icon } = script.meta;
    if (isRemote(icon)) {
      const fullUrl = pathMap[icon] || icon;
      touch(cacheKeys, fullUrl);
    }
  });
  mappings.forEach(([substore, map]) => {
    map::forEachEntry(([key, value]) => {
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

/** @typedef VMScript
 * @property {VMScriptConfig} config
 * @property {VMScriptCustom} custom
 * @property {VMScriptMeta} meta
 * @property {VMScriptProps} props
 */
/** @typedef VMScriptConfig *
 * @property {Boolean} enabled - stored as 0 or 1
 * @property {Boolean} removed - stored as 0 or 1
 * @property {Boolean} shouldUpdate - stored as 0 or 1
 * @property {Boolean | null} notifyUpdates - stored as 0 or 1 or null (default) which means "use global setting"
 */
/** @typedef VMScriptCustom *
 * @property {string} name
 * @property {string} downloadURL
 * @property {string} homepageURL
 * @property {string} lastInstallURL
 * @property {string} updateURL
 * @property {'auto' | 'page' | 'content'} injectInto
 * @property {null | 1 | 0} noframes - null or absence == default (script's value)
 * @property {string[]} exclude
 * @property {string[]} excludeMatch
 * @property {string[]} include
 * @property {string[]} match
 * @property {boolean} origExclude
 * @property {boolean} origExcludeMatch
 * @property {boolean} origInclude
 * @property {boolean} origMatch
 * @property {Object} pathMap
 * @property {VMScriptRunAt} runAt
 */
/** @typedef VMScriptMeta *
 * @property {string} description
 * @property {string} downloadURL
 * @property {string[]} exclude
 * @property {string[]} excludeMatch
 * @property {string[]} grant
 * @property {string} homepageURL
 * @property {string} icon
 * @property {string[]} include
 * @property {'auto' | 'page' | 'content'} injectInto
 * @property {string[]} match
 * @property {string} namespace
 * @property {string} name
 * @property {boolean} noframes
 * @property {string[]} require
 * @property {Object} resources
 * @property {VMScriptRunAt} runAt
 * @property {string} supportURL
 * @property {string} version
 */
/** @typedef VMScriptProps *
 * @property {number} id
 * @property {number} lastModified
 * @property {number} lastUpdated
 * @property {number} position
 * @property {string} uri
 * @property {string} uuid
 */
/**
 * @typedef {
   'document-start' | 'document-body' | 'document-end' | 'document-idle'
 } VMScriptRunAt
 */
